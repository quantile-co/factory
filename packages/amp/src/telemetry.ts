import { randomBytes } from "node:crypto";
import { managedConfig } from "@quantile-co/factory-otel/config";
import {
  exportSpans,
  type MetadataSpan,
  metadataSpan,
} from "@quantile-co/factory-otel/otlp";

// Standalone native plugin, bundled with Node built-ins only. No transcript API,
// telemetry SDK, keepAlive, shell commands or dependency on the awake plugin.
type Message = {
  role: string;
  id: string | number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
};
type Event = {
  thread: { id: string };
  id?: string | number;
  toolUseID?: string;
  tool?: string;
  status?: string;
  messages?: Message[];
};
export type TelemetryPlugin = {
  on(name: string, handler: (event: Event) => unknown): unknown;
  logger: { log(message: string): void };
};
const nano = () => (BigInt(Date.now()) * 1_000_000n).toString();
const identity = (event: Event, id: string | number | undefined) =>
  typeof event.thread?.id === "string" &&
  event.thread.id.length <= 256 &&
  (typeof id === "string" || typeof id === "number") &&
  String(id).length <= 256
    ? JSON.stringify([event.thread.id, id])
    : undefined;

export default function telemetry(amp: TelemetryPlugin): void {
  if (process.env.AMP_ORB !== "1") return;
  let config: ReturnType<typeof managedConfig>;
  try {
    config = managedConfig(process.env);
  } catch {
    amp.logger.log("OTel telemetry disabled: invalid runtime configuration.");
    return;
  }
  if (!config) return;
  const destination = config;
  const instance = randomBytes(16).toString("hex");
  const turns = new Map<string, string>();
  const tools = new Map<string, string>();
  const usageSeen = new Set<string>();
  const queue: MetadataSpan[] = [];
  let pending: Promise<void> | undefined;
  let warned = false;

  function emit(
    name: string,
    start: string,
    values: Record<string, string | number>,
    thread?: string,
  ) {
    if (queue.length >= 64) return;
    if (
      /^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        thread ?? "",
      )
    )
      values["amp.thread.id"] = thread ?? "unknown";
    queue.push(metadataSpan(name, start, nano(), values));
  }
  function flush(): Promise<void> {
    if (pending) return pending;
    if (!queue.length) return Promise.resolve();
    pending = exportSpans(
      destination,
      {
        "service.name": "factory-amp",
        "service.instance.id": instance,
      },
      "factory.amp",
      queue.splice(0, 64),
      2,
    )
      .then((sent) => {
        if (!sent && !warned) {
          warned = true;
          amp.logger.log("OTel telemetry unavailable; workload continues.");
        }
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  function start(map: Map<string, string>, id: string | undefined) {
    if (id && !map.has(id) && map.size < 1024) map.set(id, nano());
  }
  function finish(
    map: Map<string, string>,
    id: string | undefined,
    name: string,
    event: Event,
  ) {
    if (!id) return;
    const began = map.get(id);
    map.delete(id);
    if (!began) return;
    const attributes: Record<string, string> = {
      "amp.outcome": ["done", "error", "cancelled"].includes(event.status ?? "")
        ? (event.status ?? "unknown")
        : "unknown",
    };
    if (name === "amp.tool" && /^[\w.-]{1,80}$/.test(event.tool ?? ""))
      attributes["amp.tool.name"] = event.tool ?? "unknown";
    emit(name, began, attributes, event.thread.id);
  }
  amp.on("agent.start", (event) => {
    start(turns, identity(event, event.id));
  });
  amp.on("tool.call", (event) => {
    start(tools, identity(event, event.toolUseID));
    return { action: "allow" };
  });
  amp.on("tool.result", (event) => {
    finish(tools, identity(event, event.toolUseID), "amp.tool", event);
    void flush();
    // Returning undefined leaves the native tool result unchanged.
  });
  amp.on("agent.end", async (event) => {
    finish(turns, identity(event, event.id), "amp.agent", event);
    // The pinned public ThreadMessage schema currently omits usage. Only consume
    // actual numeric message usage if supplied; never estimate or read transcripts.
    for (const message of event.messages ?? []) {
      const id = identity(event, message.id);
      if (
        message.role !== "assistant" ||
        !id ||
        !message.usage ||
        usageSeen.has(id) ||
        usageSeen.size >= 8192
      )
        continue;
      const values: Record<string, number> = {};
      for (const [field, name] of [
        ["inputTokens", "gen_ai.usage.input_tokens"],
        ["outputTokens", "gen_ai.usage.output_tokens"],
        ["cacheCreationInputTokens", "amp.usage.cache_creation_input_tokens"],
        ["cacheReadInputTokens", "amp.usage.cache_read_input_tokens"],
      ] as const) {
        const value = message.usage[field];
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          values[name] = value;
      }
      if (Object.keys(values).length) {
        usageSeen.add(id);
        emit("amp.usage", nano(), values, event.thread.id);
      }
    }
    await flush();
    // A tool flush already in flight may have preceded this turn's final spans.
    await flush();
  });
  const timer = setInterval(() => {
    void flush();
  }, 5_000);
  timer.unref();
}
