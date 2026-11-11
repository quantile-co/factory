import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export function clickstackConfig(env: NodeJS.ProcessEnv) {
  const endpoint = env.CLICKSTACK_OTLP_ENDPOINT;
  const key = env.CLICKSTACK_API_KEY;
  if (!endpoint && !key) return undefined;
  try {
    const url = new URL(endpoint ?? "");
    if (
      !endpoint ||
      endpoint !== endpoint.trim() ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !key ||
      !/^[\x21-\x7e]{1,4096}$/.test(key)
    )
      throw new Error();
    return { endpoint: url.origin, key };
  } catch {
    throw new Error(
      "Invalid ClickStack configuration; supply an HTTPS base endpoint and raw ingestion key together.",
    );
  }
}

export function withoutClickstack(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.CLICKSTACK_OTLP_ENDPOINT;
  delete result.CLICKSTACK_API_KEY;
  delete result.CLICKSTACK_DOCKER_STATS;
  delete result.FACTORY_CLICKSTACK;
  return result;
}

// No credential files, logs, persisted queues, listeners or ambient provider secrets.
function collectorEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "CLICKSTACK_OTLP_ENDPOINT",
    "CLICKSTACK_API_KEY",
    "CLICKSTACK_DOCKER_STATS",
    "GITHUB_ACTIONS",
    "GITHUB_REF",
    "GITHUB_EVENT_NAME",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "AMP_ORB",
    "FACTORY_AMP_TELEMETRY_REPOSITORY",
    "FACTORY_AMP_THREAD",
  ])
    result[name] = env[name];
  return result;
}

export function startCollector(
  env: NodeJS.ProcessEnv,
  binary = "factory-otelcol",
  args: string[] = [],
): () => Promise<void> {
  const child = spawn(binary, args, {
    env: {
      ...collectorEnvironment(env),
      ...resourceEnvironment(env),
      CLICKSTACK_OTLP_ENDPOINT: clickstackConfig(env)?.endpoint,
    },
    stdio: "ignore",
  });
  let closed = false;
  const done = new Promise<void>((resolve) => {
    child.once("error", () => {
      closed = true;
      resolve();
    });
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });
  let stopping: Promise<void> | undefined;
  return () =>
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
}

export async function withCollector<T>(
  task: (env: NodeJS.ProcessEnv) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<T> {
  let stop: (() => Promise<void>) | undefined;
  const cancel = () => {
    void stop?.();
  };
  try {
    // This is defense in depth, not a substitute for workflow secret-release gates.
    if (
      env.FACTORY_CLICKSTACK === "1" &&
      env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      !signal?.aborted &&
      clickstackConfig(env)
    ) {
      stop = startCollector(env);
      signal?.addEventListener("abort", cancel, { once: true });
    }
  } catch {
    console.error(
      "ClickStack collector disabled: invalid runtime configuration.",
    );
  }
  const started = Date.now();
  let outcome = "success";
  try {
    return await task(withoutClickstack(env));
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (stop)
      await Promise.all([
        stop(),
        exportTask(
          env,
          started,
          Date.now(),
          signal?.aborted ? "cancelled" : outcome,
        ),
      ]);
  }
}

export function resourceEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const runner = env.GITHUB_ACTIONS === "true";
  const orb = env.AMP_ORB === "1";
  const repository = runner
    ? env.GITHUB_REPOSITORY
    : orb
      ? env.FACTORY_AMP_TELEMETRY_REPOSITORY
      : "";
  return {
    FACTORY_OTEL_INSTANCE_ID: randomUUID(),
    FACTORY_OTEL_PLATFORM: runner ? "namespace" : orb ? "amp-orb" : "host",
    FACTORY_OTEL_REPOSITORY:
      /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository ?? "")
        ? repository
        : "unknown",
    FACTORY_OTEL_RUN_ID:
      runner && /^\d{1,24}$/.test(env.GITHUB_RUN_ID ?? "")
        ? env.GITHUB_RUN_ID
        : "unknown",
    FACTORY_OTEL_RUN_ATTEMPT:
      runner && /^\d{1,6}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
        ? env.GITHUB_RUN_ATTEMPT
        : "unknown",
    FACTORY_OTEL_THREAD_ID:
      orb &&
      /^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        env.FACTORY_AMP_THREAD ?? "",
      )
        ? env.FACTORY_AMP_THREAD
        : "unknown",
  };
}

// One metadata-only span for the owned CI task. No command, arguments, output,
// provider data or raw failures. A single bounded attempt never gates the task.
export async function exportTask(
  env: NodeJS.ProcessEnv,
  start: number,
  end: number,
  outcome: string,
): Promise<void> {
  try {
    const config = clickstackConfig(env);
    if (!config || env.GITHUB_ACTIONS !== "true" || !agentRuntime(env)) return;
    const resource = resourceEnvironment(env);
    const attributes = [
      ["vcs.repository.name", resource.FACTORY_OTEL_REPOSITORY],
      ["cicd.pipeline.run.id", resource.FACTORY_OTEL_RUN_ID],
      ["cicd.pipeline.run.attempt", resource.FACTORY_OTEL_RUN_ATTEMPT],
      [
        "factory.task.outcome",
        ["success", "error", "cancelled"].includes(outcome)
          ? outcome
          : "unknown",
      ],
    ].map(([key, value]) => ({ key, value: { stringValue: value } }));
    const response = await fetch(`${config.endpoint}/v1/traces`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1_500),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "factory-ci" } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "factory.namespace" },
                spans: [
                  {
                    traceId: randomUUID().replaceAll("-", ""),
                    spanId: randomUUID().replaceAll("-", "").slice(0, 16),
                    name: "factory.task",
                    startTimeUnixNano: (BigInt(start) * 1_000_000n).toString(),
                    endTimeUnixNano: (BigInt(end) * 1_000_000n).toString(),
                    attributes,
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    let text = "";
    let size = 0;
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const partial = text ? JSON.parse(text).partialSuccess : undefined;
    if (
      partial &&
      (Number(partial.rejectedSpans ?? 0) !== 0 || partial.errorMessage)
    )
      throw new Error();
  } catch {
    console.error(
      "ClickStack task telemetry unavailable; workload result preserved.",
    );
  }
}

function agentRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_ACTIONS === "true"
    ? env.GITHUB_REF === "refs/heads/main" &&
        env.GITHUB_EVENT_NAME === "workflow_dispatch"
    : env.AMP_ORB === "1";
}

// Cold Nix entry point: Node built-ins only; importing the library starts nothing.
export function runCollector(
  binary: string,
  host: string,
  docker: string,
  command: string[] = [],
): void {
  if (command.length) {
    if (command[0] !== "--" || command.length < 2) {
      console.error("Usage: factory-otelcol [-- command [arguments...]]");
      process.exitCode = 1;
      return;
    }
    const env = process.env;
    let stop: (() => Promise<void>) | undefined;
    try {
      if (clickstackConfig(env) && agentRuntime(env)) {
        const args = ["--config", host];
        if (env.CLICKSTACK_DOCKER_STATS === "1") args.push("--config", docker);
        stop = startCollector(env, binary, args);
      }
    } catch {
      console.error(
        "ClickStack collector disabled: invalid runtime configuration.",
      );
    }
    const started = Date.now();
    const child = spawn(command[1], command.slice(2), {
      env: withoutClickstack(env),
      stdio: "inherit",
    });
    const cancel = () => {
      child.kill("SIGTERM");
      void stop?.();
    };
    process.once("SIGTERM", cancel);
    process.once("SIGINT", cancel);
    child.on("error", () => {
      console.error("Unable to start workload.");
      process.exitCode = 1;
    });
    child.on("close", async (code) => {
      if (stop)
        await Promise.all([
          stop(),
          exportTask(
            env,
            started,
            Date.now(),
            code === 0 ? "success" : code === null ? "cancelled" : "error",
          ),
        ]);
      process.removeListener("SIGTERM", cancel);
      process.removeListener("SIGINT", cancel);
      process.exitCode = code ?? 1;
    });
    return;
  }
  try {
    const config = clickstackConfig(process.env);
    if (config) {
      if (!agentRuntime(process.env)) {
        console.error(
          "ClickStack collector requires an orb or trusted-main runner job.",
        );
        process.exitCode = 1;
        return;
      }
      const args = ["--config", host];
      if (process.env.CLICKSTACK_DOCKER_STATS === "1")
        args.push("--config", docker);
      const child = spawn(binary, args, {
        env: {
          ...collectorEnvironment(process.env),
          ...resourceEnvironment(process.env),
          CLICKSTACK_OTLP_ENDPOINT: config.endpoint,
        },
        stdio: "ignore",
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (timer) return;
        child.kill("SIGTERM");
        timer = setTimeout(() => child.kill("SIGKILL"), 4_000);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      child.on("error", () => {
        console.error("ClickStack collector unavailable.");
        process.exitCode = 1;
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        process.removeListener("SIGTERM", stop);
        process.removeListener("SIGINT", stop);
        if (code && !timer) {
          console.error("ClickStack collector stopped.");
          process.exitCode = 1;
        }
      });
    }
  } catch {
    console.error(
      "Invalid ClickStack runtime configuration; collector disabled.",
    );
    process.exitCode = 1;
  }
}
