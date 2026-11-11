import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { clickstackConfig as ampConfig } from "../../amp/src/telemetry.ts";
import {
  clickstackConfig,
  exportTask,
  resourceEnvironment,
  withCollector,
} from "./collector.ts";

const credentials = {
  CLICKSTACK_OTLP_ENDPOINT: "https://ingest.example.invalid/",
  CLICKSTACK_API_KEY: "fixture-key",
};
it("uses one runtime contract, rejects partial/unsafe values without echoing them, and bounds identity", () => {
  for (const config of [clickstackConfig, ampConfig]) {
    expect(config({})).toBeUndefined();
    expect(config(credentials)?.endpoint).toBe(
      "https://ingest.example.invalid",
    );
    for (const env of [
      { CLICKSTACK_API_KEY: "sensitive" },
      { CLICKSTACK_OTLP_ENDPOINT: "https://sensitive.invalid" },
      { ...credentials, CLICKSTACK_OTLP_ENDPOINT: "http://sensitive.invalid" },
      {
        ...credentials,
        CLICKSTACK_OTLP_ENDPOINT: "https://user:sensitive@host.invalid",
      },
      {
        ...credentials,
        CLICKSTACK_OTLP_ENDPOINT: "https://host.invalid/v1/traces",
      },
      {
        ...credentials,
        CLICKSTACK_OTLP_ENDPOINT: "https://host.invalid/?sensitive",
      },
      { ...credentials, CLICKSTACK_API_KEY: "Bearer sensitive" },
    ]) {
      try {
        config(env);
        throw new Error("accepted sensitive input");
      } catch (error) {
        expect(String(error)).not.toContain("sensitive");
      }
    }
  }
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "org/repo",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    OTEL_RESOURCE_ATTRIBUTES: "private=value",
  };
  const first = resourceEnvironment(env);
  expect(first.FACTORY_OTEL_REPOSITORY).toBe("org/repo");
  expect(first.FACTORY_OTEL_RUN_ID).toBe("123");
  expect(resourceEnvironment(env).FACTORY_OTEL_INSTANCE_ID).not.toBe(
    first.FACTORY_OTEL_INSTANCE_ID,
  );
  expect(JSON.stringify(first)).not.toContain("private");
  expect(
    resourceEnvironment({ ...env, GITHUB_REPOSITORY: "untrusted\nvalue" })
      .FACTORY_OTEL_REPOSITORY,
  ).toBe("unknown");
});

it("exports just CI task identity, duration and outcome and fails open on ingestion rejection", async () => {
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response(
        '{"partialSuccess":{"rejectedSpans":"1","errorMessage":"PRIVATE_SERVER_ERROR"}}',
      ),
    );
  vi.stubGlobal("fetch", send);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await exportTask(
      {
        ...credentials,
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/heads/main",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REPOSITORY: "org/repo",
        GITHUB_RUN_ID: "123",
        PRIVATE: "PRIVATE_VALUE",
      },
      1000,
      1250,
      "error",
    );
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0][1].body;
    expect(body).not.toMatch(/PRIVATE_|fixture-key/);
    const span = JSON.parse(body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("factory.task");
    expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(
      250_000_000n,
    );
    expect(span.attributes).toContainEqual({
      key: "factory.task.outcome",
      value: { stringValue: "error" },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "PRIVATE_SERVER_ERROR",
    );
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    log.mockRestore();
  }
});

it("does not require telemetry for a workload and strips its credentials even outside trusted CI", async () => {
  for (const env of [
    {},
    credentials,
    {
      ...credentials,
      FACTORY_CLICKSTACK: "1",
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/pull/1/merge",
    },
  ]) {
    expect(
      await withCollector(async (child) => {
        expect(child.CLICKSTACK_API_KEY).toBeUndefined();
        expect(child.CLICKSTACK_OTLP_ENDPOINT).toBeUndefined();
        return 42;
      }, env),
    ).toBe(42);
  }
});

it("native workload lifecycle isolates environments, cleans up on failure, and fails open without a collector", () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-otel-test-"));
  try {
    const collector = join(directory, "collector");
    const record = join(directory, "record");
    writeFileSync(
      collector,
      `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ instance: process.env.FACTORY_OTEL_INSTANCE_ID, repo: process.env.FACTORY_OTEL_REPOSITORY, secret: !!process.env.CLICKSTACK_API_KEY, ambient: !!process.env.OTEL_RESOURCE_ATTRIBUTES, provider: !!process.env.GH_REPO_TOKEN, args: process.argv.slice(2) }));
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(record)}, '\\nstopped'); process.exit(0); });
setInterval(() => {}, 1000);
`,
    );
    chmodSync(collector, 0o755);
    const entry = new URL("./collector.ts", import.meta.url).href;
    const command = [
      "--",
      process.execPath,
      "-e",
      `if (process.env.CLICKSTACK_API_KEY || process.env.CLICKSTACK_OTLP_ENDPOINT) process.exit(91); setTimeout(() => process.exit(23), 300);`,
    ];
    const run = (binary: string, extra = {}) =>
      spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `globalThis.fetch = async () => ({ ok: true }); import { runCollector } from ${JSON.stringify(entry)}; runCollector(${JSON.stringify(binary)}, 'host.yaml', 'docker.yaml', ${JSON.stringify(command)});`,
        ],
        {
          env: {
            ...process.env,
            ...credentials,
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REF: "refs/heads/main",
            GITHUB_REPOSITORY: "org/repo",
            OTEL_RESOURCE_ATTRIBUTES: "private=value",
            GH_REPO_TOKEN: "fixture-provider",
            ...extra,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
    expect(run(collector).status).toBe(23);
    const [result, stopped] = readFileSync(record, "utf8").split("\n");
    expect(JSON.parse(result)).toMatchObject({
      repo: "org/repo",
      secret: true,
      ambient: false,
      provider: false,
      args: ["--config", "host.yaml"],
    });
    expect(stopped).toBe("stopped");
    expect(run(join(directory, "missing")).status).toBe(23);
    expect(run(collector, { CLICKSTACK_API_KEY: "" }).status).toBe(23);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
