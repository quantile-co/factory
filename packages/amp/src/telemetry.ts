import { ROOT_CONTEXT, type Span, trace } from "@opentelemetry/api";
import { createTracing } from "@quantile-co/factory-otel";
import { collectorEndpoint } from "@quantile-co/factory-otel/config";

// Metadata only: no transcript API, shell commands or keep-awake dependency.
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
const identity = (event: Event, id: string | number | undefined) =>
  typeof event.thread?.id === "string" &&
  event.thread.id.length <= 256 &&
  (typeof id === "string" || typeof id === "number") &&
  String(id).length <= 256
    ? JSON.stringify([event.thread.id, id])
    : undefined;

export default function telemetry(amp: TelemetryPlugin): void {
  if (process.env.AMP_ORB !== "1") return;
  try {
    if (collectorEndpoint() === undefined) return;
  } catch {
    amp.logger.log("OTel telemetry disabled: invalid runtime configuration.");
    return;
  }
  // The SDK owns local Collector transport and batching; never register with
  // the host's global provider or pass outbound credentials from this adapter.
  const provider = createTracing("factory-amp");
  const tracer = provider.getTracer("factory.amp");
  type OpenSpan = { threadId: string; span: Span };
  const turns = new Map<string, OpenSpan>();
  const tools = new Map<string, OpenSpan>();
  const usageSeen = new Set<string>();
  let warned = false;

  function safely(action: () => void) {
    try {
      action();
    } catch {
      if (!warned) {
        warned = true;
        amp.logger.log("OTel telemetry unavailable; workload continues.");
      }
    }
  }
  function attributes(event: Event): Record<string, string> {
    return /^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      event.thread?.id ?? "",
    )
      ? { "amp.thread.id": event.thread.id }
      : {};
  }
  // Tool events identify the thread, not the turn. Never guess if turns overlap.
  function toolParent(threadId: string) {
    let parent: Span | undefined;
    for (const turn of turns.values()) {
      if (turn.threadId !== threadId) continue;
      if (parent) return ROOT_CONTEXT;
      parent = turn.span;
    }
    return parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT;
  }
  function start(
    map: Map<string, OpenSpan>,
    id: string | undefined,
    name: string,
    event: Event,
    parent = ROOT_CONTEXT,
  ) {
    if (id !== undefined && !map.has(id) && map.size < 1024)
      map.set(id, {
        threadId: event.thread.id,
        span: tracer.startSpan(name, { attributes: attributes(event) }, parent),
      });
  }
  function finish(
    map: Map<string, OpenSpan>,
    id: string | undefined,
    event: Event,
    tool = false,
  ) {
    if (id === undefined) return;
    const span = map.get(id)?.span;
    map.delete(id);
    if (!span) return;
    try {
      span.setAttribute(
        "amp.outcome",
        ["done", "error", "cancelled"].includes(event.status ?? "")
          ? (event.status ?? "unknown")
          : "unknown",
      );
      if (tool && /^[\w.-]{1,80}$/.test(event.tool ?? ""))
        span.setAttribute("amp.tool.name", event.tool ?? "unknown");
    } finally {
      span.end();
    }
  }
  amp.on("agent.start", (event) => {
    safely(() => start(turns, identity(event, event.id), "amp.agent", event));
  });
  amp.on("tool.call", (event) => {
    safely(() =>
      start(
        tools,
        identity(event, event.toolUseID),
        "amp.tool",
        event,
        toolParent(event.thread.id),
      ),
    );
    return { action: "allow" };
  });
  amp.on("tool.result", (event) => {
    safely(() => finish(tools, identity(event, event.toolUseID), event, true));
    // Returning undefined leaves the native tool result unchanged.
  });
  amp.on("agent.end", async (event) => {
    const turnId = identity(event, event.id);
    const turn = turnId === undefined ? undefined : turns.get(turnId)?.span;
    const context = turn ? trace.setSpan(ROOT_CONTEXT, turn) : ROOT_CONTEXT;
    safely(() => finish(turns, turnId, event));
    safely(() => {
      // The pinned public ThreadMessage schema currently omits usage. Only consume
      // actual numeric message usage if supplied; never estimate or read transcripts.
      for (const message of event.messages ?? []) {
        const id = identity(event, message.id);
        if (
          message.role !== "assistant" ||
          id === undefined ||
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
          tracer
            .startSpan(
              "amp.usage",
              { attributes: { ...attributes(event), ...values } },
              context,
            )
            .end();
        }
      }
    });
    await provider.forceFlush().catch(() => {});
  });
}
