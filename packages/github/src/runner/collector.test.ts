import assert from "node:assert/strict";
import childProcess, {
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import {
  collectorEnvironment,
  processIdentity,
  startCollector,
  stopCollector,
  verifyArchive,
} from "./collector.ts";
import { runnerTailnetSuffix, startRunnerJob } from "./job.ts";

test("collector receives only runtime observations, not job credentials", () => {
  const env = collectorEnvironment(
    {
      GITHUB_RUN_ID: "123",
      GITHUB_ACTOR: "alice",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "private",
      TURBO_TOKEN: "private",
    },
    "https://ingest.test",
  );
  assert(env.QUANTILE_OTELCOL_METADATA);
  assert.deepEqual(
    JSON.parse(Buffer.from(env.QUANTILE_OTELCOL_METADATA, "base64").toString()),
    { GITHUB_RUN_ID: "123", GITHUB_ACTOR: "alice" },
  );
  assert(!JSON.stringify(env).includes("private"));
});

test("reads the MagicDNS suffix from network settings without resolving a service", () => {
  assert.equal(
    runnerTailnetSuffix(
      "nameserver 100.100.100.100\nsearch local Test.ts.net. # profile\n",
    ),
    "test.ts.net",
  );
  assert.throws(
    () => runnerTailnetSuffix("# search ignored.ts.net\nsearch local"),
    /MagicDNS/,
  );
  assert.throws(
    () => runnerTailnetSuffix("search first.ts.net second.ts.net"),
    /MagicDNS/,
  );
});

test("composes independent service origins without contacting remote services", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runner-job-test-"));
  const envFile = join(directory, "github-env");
  const network = vi.fn(() => {
    throw new Error("unexpected remote probe");
  });
  vi.stubGlobal("fetch", network);
  try {
    await startRunnerJob(
      { RUNNER_TEMP: directory, GITHUB_ENV: envFile },
      {
        loadNetwork: async () => "search test.ts.net",
        start: async ({ env }) => {
          assert.equal(env.QUANTILE_OTLP_ENDPOINT, "https://otel.test.ts.net");
          assert.equal(env.QUANTILE_AI_GATEWAY_ENDPOINT, undefined);
        },
      },
    );
    const settings = await readFile(envFile, "utf8");
    assert.match(
      settings,
      /^QUANTILE_AI_GATEWAY_ENDPOINT=https:\/\/ai-gateway\.test\.ts\.net$/m,
    );
    assert.match(
      settings,
      /^QUANTILE_OTLP_ENDPOINT=https:\/\/otel\.test\.ts\.net$/m,
    );
    assert.equal(network.mock.calls.length, 0);
  } finally {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  }
});

test("release checksum rejects changed bytes", () => {
  const bytes = Buffer.from("fixture archive");
  const digest = createHash("sha256").update(bytes).digest("hex");
  verifyArchive(bytes, digest);
  assert.throws(
    () => verifyArchive(Buffer.from("changed"), digest),
    /checksum mismatch/,
  );
});

test("native process becomes ready, survives start, and flushes on post shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-runner-test-"));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  try {
    await startCollector({
      binary: process.execPath,
      args: [
        "-e",
        `
        const http = require('node:http');
        const fs = require('node:fs');
        const server = http.createServer((_, response) => response.end('ok'));
        server.listen(${port}, '127.0.0.1');
        process.on('SIGTERM', () => {
          fs.writeFileSync(process.env.FLUSH_FILE, 'flushed');
          server.close(() => process.exit(0));
        });
      `,
      ],
      directory,
      env: { ...process.env, FLUSH_FILE: join(directory, "flushed") },
      healthUrl: `http://127.0.0.1:${port}/`,
    });
    const record = JSON.parse(
      await readFile(join(directory, "process.json"), "utf8"),
    );
    assert.equal(await processIdentity(record.pid), record.started);
    await stopCollector(directory);
    assert.equal(await readFile(join(directory, "flushed"), "utf8"), "flushed");
    await stopCollector(directory); // Already stopped is harmless.
  } finally {
    await stopCollector(directory);
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed state persistence terminates the untracked child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-runner-test-"));
  const spawn = childProcess.spawn;
  let child: ChildProcess | undefined;
  const mock = vi
    .spyOn(childProcess, "spawn")
    .mockImplementation(
      (command: string, args: readonly string[], options: SpawnOptions) => {
        child = spawn(command, args, options);
        return child;
      },
    );
  syncBuiltinESMExports();
  try {
    // Force a state-write failure after a real child has started.
    await mkdir(join(directory, "process.json"));
    await assert.rejects(
      startCollector({
        binary: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        directory,
        env: {},
        healthUrl: "http://127.0.0.1:0/",
      }),
      { code: "EISDIR" },
    );
    assert(child);
    assert.equal(child.killed, true, "Untracked child must be terminated");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.ref(); // startCollector unrefs it; keep the test alive for cleanup.
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    mock.mockRestore();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed readiness stops its process; absent state and stale identity are safe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-runner-test-"));
  try {
    await stopCollector(directory);
    await assert.rejects(
      startCollector({
        binary: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        directory,
        env: process.env,
        healthUrl: "http://127.0.0.1:0/",
        timeoutMs: 200,
      }),
      /readiness timed out/,
    );
    const record = JSON.parse(
      await readFile(join(directory, "process.json"), "utf8"),
    );
    assert.equal(await processIdentity(record.pid), undefined);
    await writeFile(
      join(directory, "process.json"),
      JSON.stringify({ pid: process.pid, started: "0" }),
    );
    await stopCollector(directory); // Must not signal this test process.
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
