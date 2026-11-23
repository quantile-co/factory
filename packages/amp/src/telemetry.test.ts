import {
  type Context,
  ROOT_CONTEXT,
  type SpanOptions,
  trace,
} from "@opentelemetry/api";
import { createTracing } from "@quantile-co/factory-otel";
import { afterEach, expect, it, vi } from "vitest";
import telemetry, { type TelemetryPlugin } from "./telemetry.ts";

const sdk = vi.hoisted(() => {
  const startSpan = vi.fn(
    (_name: string, _options: SpanOptions, _context: Context) => ({
      setAttribute: vi.fn(),
      end: vi.fn(),
    }),
  );
  return {
    forceFlush: vi.fn(async () => {}),
    startSpan,
    getTracer: vi.fn(() => ({ startSpan })),
    register: vi.fn(),
  };
});
vi.mock("@quantile-co/factory-otel", () => ({
  createTracing: vi.fn(() => sdk),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function plugin() {
  const handlers = new Map<string, Parameters<TelemetryPlugin["on"]>[1]>();
  const logger = { log: vi.fn() };
  telemetry({ on: (name, handler) => handlers.set(name, handler), logger });
  return { handlers, logger };
}
function enable() {
  vi.stubEnv("AMP_ORB", "1");
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "https://ingest.example.invalid");
  vi.stubEnv("QUANTILE_OTLP_INGEST_TOKEN", "fixture-secret");
}
const event = {
  thread: { id: "T-12345678-1234-1234-1234-123456789abc" },
  id: "turn",
  toolUseID: "tool-1",
  tool: "Bash",
  status: "error",
};

it("is inert outside orbs or without an endpoint and rejects unsafe configuration", () => {
  enable();
  vi.stubEnv("AMP_ORB", "0");
  expect(plugin().handlers.size).toBe(0);
  vi.stubEnv("AMP_ORB", "1");
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "http://ingest.example.invalid");
  const partial = plugin();
  expect(partial.handlers.size).toBe(0);
  expect(JSON.stringify(partial.logger.log.mock.calls)).not.toContain(
    "ingest.example",
  );
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "");
  expect(plugin().logger.log).not.toHaveBeenCalled();
  expect(createTracing).not.toHaveBeenCalled();
});

it("uses a private SDK tracer and emits only metadata and actual deduplicated usage", () => {
  enable();
  const { handlers } = plugin();
  const privateEvent = {
    ...event,
    input: "PRIVATE_INPUT",
    output: "PRIVATE_OUTPUT",
  };
  expect(handlers.get("agent.start")?.(privateEvent)).toBeUndefined();
  const turn = sdk.startSpan.mock.results[0].value;
  const toolEvent = {
    thread: event.thread,
    toolUseID: event.toolUseID,
    tool: event.tool,
    status: event.status,
  };
  expect(handlers.get("tool.call")?.(toolEvent)).toEqual({
    action: "allow",
  });
  const tool = sdk.startSpan.mock.results[1].value;
  expect(handlers.get("tool.result")?.(toolEvent)).toBeUndefined();
  const messages = [
    {
      role: "assistant",
      id: "m1",
      content: "PRIVATE_MESSAGE",
      usage: { inputTokens: 15, outputTokens: 3, cacheReadInputTokens: 2 },
    },
    { role: "assistant", id: "m2", content: "PRIVATE_MESSAGE" },
    { role: "user", id: "m3", usage: { inputTokens: 50 } },
    {
      role: "assistant",
      id: "m4",
      usage: { inputTokens: -1, outputTokens: NaN },
    },
  ];
  handlers.get("agent.end")?.({ ...event, messages });
  handlers.get("agent.end")?.({ ...event, messages });
  expect(createTracing).toHaveBeenCalledExactlyOnceWith("factory-amp");
  expect(sdk.getTracer).toHaveBeenCalledExactlyOnceWith("factory.amp");
  expect(sdk.register).not.toHaveBeenCalled();
  expect(sdk.startSpan.mock.calls.map((call) => call[0])).toEqual([
    "amp.agent",
    "amp.tool",
    "amp.usage",
  ]);
  expect(sdk.startSpan.mock.calls[0][2]).toBe(ROOT_CONTEXT);
  expect(trace.getSpan(sdk.startSpan.mock.calls[1][2])).toBe(turn);
  expect(trace.getSpan(sdk.startSpan.mock.calls[2][2])).toBe(turn);
  expect(sdk.startSpan.mock.calls[2][1]).toEqual({
    attributes: {
      "amp.thread.id": event.thread.id,
      "gen_ai.usage.input_tokens": 15,
      "gen_ai.usage.output_tokens": 3,
      "amp.usage.cache_read_input_tokens": 2,
    },
  });
  expect(turn.end).toHaveBeenCalledOnce();
  expect(tool.end).toHaveBeenCalledOnce();
  expect(tool.setAttribute).toHaveBeenCalledWith("amp.outcome", "error");
  expect(tool.setAttribute).toHaveBeenCalledWith("amp.tool.name", "Bash");
  expect(JSON.stringify(sdk.startSpan.mock.calls)).not.toMatch(
    /PRIVATE_|fixture-secret|ingest.example|tool-1/,
  );
});

it("matches IDs within threads and does not invent parents for unmatched tools", () => {
  enable();
  const { handlers } = plugin();
  handlers.get("agent.start")?.(event);
  const other = { ...event, thread: { id: "other-thread" } };
  handlers.get("tool.call")?.(other);
  expect(sdk.startSpan.mock.calls[1][2]).toBe(ROOT_CONTEXT);
  handlers.get("agent.end")?.(other);
  expect(sdk.startSpan.mock.results[0].value.end).not.toHaveBeenCalled();
  handlers.get("tool.result")?.(event);
  expect(sdk.startSpan.mock.results[1].value.end).not.toHaveBeenCalled();
  handlers.get("tool.result")?.(other);
  expect(sdk.startSpan.mock.results[1].value.end).toHaveBeenCalledOnce();
  expect(sdk.startSpan.mock.calls[1][1]).toEqual({ attributes: {} });
});

it("bounds and deduplicates in-flight spans", () => {
  enable();
  const { handlers } = plugin();
  for (let id = 0; id < 1025; id++)
    handlers.get("agent.start")?.({ ...event, id });
  handlers.get("agent.start")?.({ ...event, id: 0 });
  expect(sdk.startSpan).toHaveBeenCalledTimes(1024);
  handlers.get("agent.end")?.({ ...event, id: 0 });
  handlers.get("agent.start")?.({ ...event, id: 1024 });
  expect(sdk.startSpan).toHaveBeenCalledTimes(1025);
});

it("keeps native tool behavior and sanitizes failures from the SDK", () => {
  enable();
  const { handlers, logger } = plugin();
  sdk.startSpan.mockImplementationOnce(() => {
    throw new Error("PRIVATE_FAILURE");
  });
  expect(handlers.get("tool.call")?.(event)).toEqual({ action: "allow" });
  expect(handlers.get("tool.result")?.(event)).toBeUndefined();
  expect(logger.log).toHaveBeenCalledExactlyOnceWith(
    "OTel telemetry unavailable; workload continues.",
  );
});
