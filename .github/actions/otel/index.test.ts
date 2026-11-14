import assert from "node:assert/strict";
import childProcess, {
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  consolePagePattern,
  discoverConsolePrefix,
  processIdentity,
  runtimeJobId,
  startCollector,
  stopCollector,
  verifyArchive,
} from "./index.ts";

test("console selection requires a single explicit runner timeline/record prefix", () => {
  const timeline = "11111111-1111-1111-1111-111111111111";
  const job = "22222222-2222-2222-2222-222222222222";
  const prefix = `/runner/_diag/pages/${timeline}_${job}_`;
  assert.equal(consolePagePattern(prefix), `${prefix}*.log`);
  for (const invalid of [
    "/runner/_diag/pages/*",
    `/runner/_diag/pages/${timeline}_build_`,
    `/runner/_diag/Worker_${job}_`,
    `/tmp/saved-plan/${timeline}_${job}_`,
    `/runner*/_diag/pages/${timeline}_${job}_`,
    prefix.slice(1),
  ]) {
    assert.throws(() => consolePagePattern(invalid), /Expected an absolute/);
  }
  // Syntax cannot distinguish a step UUID from a job UUID; the trusted caller
  // must establish that identity. This fixture does NOT qualify live selection.
});

const plan = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function runtimeToken(scp: unknown) {
  return `e30.${Buffer.from(JSON.stringify({ scp })).toString("base64url")}.c2ln`;
}

test("runtime scope identifies the job, not the plan, and rejects malformed/ambiguous claims safely", () => {
  const scope = `Actions.Results:${plan}:${job}`;
  assert.equal(runtimeJobId(runtimeToken(`Other.Scope ${scope}`)), job);
  for (const token of [
    undefined,
    "e30.e2JhZA.c2ln",
    runtimeToken(42),
    runtimeToken(`Actions.Results:${plan}:not-a-uuid`),
    runtimeToken(`${scope} ${scope}`),
    runtimeToken("Other.Scope"),
  ]) {
    assert.throws(() => runtimeJobId(token), {
      message: "Invalid Actions.Results runtime job identity",
    });
  }
});

test("auto discovery follows Worker ancestry and selects one open job prefix, not step or stale pages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-discovery-test-"));
  const timeline = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const worker = process.ppid + 1;
  const parent = join(directory, String(process.ppid));
  const workerProc = join(directory, String(worker));
  const root = join(directory, "runner");
  const pages = join(root, "_diag", "pages");
  const prefix = join(pages, `${timeline}_${job}_`);
  const token = runtimeToken(`Actions.Results:${plan}:${job}`);
  try {
    await mkdir(parent);
    await mkdir(join(workerProc, "fd"), { recursive: true });
    await mkdir(pages, { recursive: true });
    await symlink("/usr/bin/node", join(parent, "exe"));
    await writeFile(join(parent, "stat"), `${process.ppid} (node) S ${worker}`);
    await symlink(join(root, "bin", "Runner.Worker"), join(workerProc, "exe"));
    // Empty files suffice: selection must not inspect any log bodies.
    await writeFile(`${prefix}1.log`, "");
    await writeFile(`${prefix}2.log`, "");
    const stepPage = join(pages, `${timeline}_${plan}_1.log`);
    await writeFile(stepPage, "");
    await symlink(`${prefix}1.log`, join(workerProc, "fd", "8"));
    await symlink(`${prefix}2.log`, join(workerProc, "fd", "9"));
    await symlink(stepPage, join(workerProc, "fd", "3"));
    assert.equal(await discoverConsolePrefix(token, directory), prefix);
    const conflicting = join(pages, `${plan}_${job}_1.log`);
    await writeFile(conflicting, "");
    assert.equal(await discoverConsolePrefix(token, directory), prefix); // Unopened file is not ownership evidence.
    await symlink(conflicting, join(workerProc, "fd", "10"));
    await assert.rejects(
      discoverConsolePrefix(token, directory),
      /requires one job page prefix/,
    );
    await rm(join(workerProc, "fd", "10"));
    await rm(join(workerProc, "fd", "8"));
    await rm(join(workerProc, "fd", "9"));
    await assert.rejects(
      discoverConsolePrefix(token, directory),
      /requires one job page prefix/,
    );
    await rm(join(workerProc, "exe"));
    await assert.rejects(
      discoverConsolePrefix(token, directory),
      /requires one job page prefix/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("post cleanup never replays private Collector diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-action-test-"));
  try {
    await writeFile(
      join(directory, "collector.log"),
      "private-exporter-payload",
    );
    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      childProcess.execFile(
        process.execPath,
        [new URL("./index.ts", import.meta.url).pathname],
        { env: { ...process.env, STATE_directory: directory } },
        (error, stdout, stderr) =>
          error ? reject(error) : resolve({ stdout, stderr }),
      );
    });
    assert.equal(stdout + stderr, "");
  } finally {
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
  const directory = await mkdtemp(join(tmpdir(), "otel-action-test-"));
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

test("failed state persistence terminates the untracked child", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "otel-action-test-"));
  const spawn = childProcess.spawn;
  let child: ChildProcess | undefined;
  context.mock.method(
    childProcess,
    "spawn",
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
    context.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed readiness stops its process; absent state and stale identity are safe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otel-action-test-"));
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
