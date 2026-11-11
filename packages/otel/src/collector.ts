import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { managedConfig, withoutCredentials } from "./config.ts";
import { exportSpans, metadataSpan } from "./otlp.ts";

// Platform owners supply these nonsecret dimensions; never discover arbitrary
// environment, container labels, hostnames or ambient OTEL_RESOURCE_ATTRIBUTES.
export function resourceEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe = (name: string, pattern: RegExp) =>
    pattern.test(env[name] ?? "") ? env[name] : "unknown";
  return {
    OTEL_AGENT_INSTANCE_ID: randomUUID(),
    OTEL_AGENT_PLATFORM: safe("OTEL_AGENT_PLATFORM", /^[a-z][a-z0-9-]{0,31}$/),
    OTEL_AGENT_REPOSITORY: safe(
      "OTEL_AGENT_REPOSITORY",
      /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    ),
    OTEL_AGENT_RUN_ID: safe("OTEL_AGENT_RUN_ID", /^\d{1,24}$/),
    OTEL_AGENT_RUN_ATTEMPT: safe("OTEL_AGENT_RUN_ATTEMPT", /^\d{1,6}$/),
    OTEL_AGENT_THREAD_ID: safe(
      "OTEL_AGENT_THREAD_ID",
      /^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
  };
}

export function startCollector(env: NodeJS.ProcessEnv = process.env) {
  // Defense in depth; workflow policy owns the actual secret-release boundary.
  if (
    env.GITHUB_ACTIONS === "true" &&
    (env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch")
  )
    return undefined;
  const config = managedConfig(env);
  if (!config) return undefined;
  const binary = env.OTEL_COLLECTOR_BINARY;
  const host = env.OTEL_COLLECTOR_CONFIG;
  const docker = env.OTEL_COLLECTOR_DOCKER_CONFIG;
  if (
    !binary ||
    !isAbsolute(binary) ||
    !host ||
    !isAbsolute(host) ||
    (env.OTEL_DOCKER_STATS === "1" && (!docker || !isAbsolute(docker)))
  )
    throw new Error(
      "OTel requires explicitly selected native collector and configuration paths.",
    );
  const args = ["--config", host];
  if (env.OTEL_DOCKER_STATS === "1" && docker) args.push("--config", docker);
  const child = spawn(binary, args, {
    env: {
      SSL_CERT_FILE: env.SSL_CERT_FILE,
      NIX_SSL_CERT_FILE: env.NIX_SSL_CERT_FILE,
      CLICKSTACK_OTLP_ENDPOINT: config.endpoint,
      CLICKSTACK_API_KEY: config.key,
      ...resourceEnvironment(env),
    },
    stdio: "ignore",
  });
  let closed = false;
  const done = new Promise<number>((resolve) => {
    child.once("error", () => {
      closed = true;
      console.error("OTel collector unavailable; workload continues.");
      resolve(1);
    });
    child.once("close", (code) => {
      closed = true;
      resolve(code ?? 1);
    });
  });
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      if (closed) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        await done;
      } finally {
        clearTimeout(timer);
      }
    })());
  return { stop, done };
}

export async function exportTask(
  env: NodeJS.ProcessEnv,
  start: number,
  end: number,
  outcome: string,
): Promise<void> {
  try {
    const config = managedConfig(env);
    if (!config) return;
    const resource = resourceEnvironment(env);
    const sent = await exportSpans(
      config,
      { "service.name": "factory-task" },
      "factory.otel",
      [
        metadataSpan(
          "otel.task",
          (BigInt(start) * 1_000_000n).toString(),
          (BigInt(end) * 1_000_000n).toString(),
          {
            "vcs.repository.name": resource.OTEL_AGENT_REPOSITORY ?? "unknown",
            "cicd.pipeline.run.id": resource.OTEL_AGENT_RUN_ID ?? "unknown",
            "cicd.pipeline.run.attempt":
              resource.OTEL_AGENT_RUN_ATTEMPT ?? "unknown",
            "otel.task.outcome": ["success", "error", "cancelled"].includes(
              outcome,
            )
              ? outcome
              : "unknown",
          },
        ),
      ],
    );
    if (!sent) throw new Error();
  } catch {
    console.error(
      "OTel task telemetry unavailable; workload result preserved.",
    );
  }
}

export async function withCollector<T>(
  task: (env: NodeJS.ProcessEnv) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<T> {
  let collector: ReturnType<typeof startCollector>;
  try {
    if (!signal?.aborted) collector = startCollector(env);
  } catch {
    console.error("OTel collector disabled: invalid runtime configuration.");
  }
  const cancel = () => {
    void collector?.stop();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  let outcome = "success";
  try {
    return await task(withoutCredentials(env));
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (collector)
      await Promise.all([
        collector.stop(),
        exportTask(
          env,
          started,
          Date.now(),
          signal?.aborted ? "cancelled" : outcome,
        ),
      ]);
  }
}

class WorkloadFailure extends Error {
  readonly code: number;
  constructor(code: number) {
    super("OTel workload failed.");
    this.code = code;
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  try {
    if (args.length === 1 && args[0] === "collector") {
      const collector = startCollector();
      if (!collector) return;
      abort.signal.addEventListener(
        "abort",
        () => {
          void collector.stop();
        },
        { once: true },
      );
      const code = await collector.done;
      if (!abort.signal.aborted) process.exitCode = code;
      return;
    }
    if (args[0] !== "--" || args.length < 2)
      throw new Error(
        "Usage: factory-otel collector | -- command [arguments...]",
      );
    await withCollector(
      (env) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(args[1], args.slice(2), {
            env,
            stdio: "inherit",
            signal: abort.signal,
          });
          child.once("error", () => reject(new WorkloadFailure(1)));
          child.once("close", (code) =>
            code === 0
              ? resolve()
              : reject(new WorkloadFailure(code && code > 0 ? code : 1)),
          );
        }),
      process.env,
      abort.signal,
    );
  } catch (error) {
    process.exitCode = abort.signal.aborted
      ? 130
      : error instanceof WorkloadFailure
        ? error.code
        : 1;
    if (!(error instanceof WorkloadFailure))
      console.error(
        "OTel command unavailable; check arguments and selected native configuration.",
      );
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
