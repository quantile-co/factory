import { afterEach, expect, it, vi } from "vitest";
import telemetry, { type TelemetryPlugin } from "./telemetry.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function plugin() {
  const handlers = new Map<string, Parameters<TelemetryPlugin["on"]>[1]>();
  const logger = { log: vi.fn() };
  telemetry({ on: (name, handler) => handlers.set(name, handler), logger });
  return { handlers, logger };
}
function enable() {
  vi.useFakeTimers();
  vi.stubEnv("AMP_ORB", "1");
  vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "https://ingest.example.invalid");
  vi.stubEnv("CLICKSTACK_API_KEY", "fixture-secret");
}
it("is inert outside orbs or without credentials and rejects partial configuration safely", () => {
  enable();
  vi.stubEnv("AMP_ORB", "0");
  expect(plugin().handlers.size).toBe(0);
  vi.stubEnv("AMP_ORB", "1");
  vi.stubEnv("CLICKSTACK_API_KEY", "");
  const partial = plugin();
  expect(partial.handlers.size).toBe(0);
  expect(JSON.stringify(partial.logger.log.mock.calls)).not.toContain(
    "ingest.example",
  );
  vi.stubEnv("CLICKSTACK_OTLP_ENDPOINT", "");
  expect(plugin().logger.log).not.toHaveBeenCalled();
});
it("emits only metadata, timings and deduplicated actual message usage without changing native results", async () => {
  enable();
  const send = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", send);
  const { handlers } = plugin();
  const thread = { id: "T-12345678-1234-1234-1234-123456789abc" };
  const event = {
    thread,
    id: 1,
    message: "PRIVATE_PROMPT",
    input: { text: "PRIVATE_ARGUMENT" },
    toolUseID: "tool-1",
    tool: "Bash",
    status: "error",
    error: "PRIVATE_ERROR",
    output: "PRIVATE_OUTPUT",
  };
  expect(await handlers.get("agent.start")?.(event)).toBeUndefined();
  expect(await handlers.get("tool.call")?.(event)).toEqual({ action: "allow" });
  vi.advanceTimersByTime(100);
  expect(await handlers.get("tool.result")?.(event)).toBeUndefined();
  const messages = [
    {
      role: "assistant",
      id: "m1",
      content: "PRIVATE_MESSAGE",
      usage: { inputTokens: 15, outputTokens: 3, cacheReadInputTokens: 2 },
    },
    { role: "assistant", id: "m2", content: "PRIVATE_MESSAGE" },
  ];
  await handlers.get("agent.end")?.({ ...event, messages });
  await handlers.get("agent.end")?.({ ...event, messages });
  const bodies = send.mock.calls.map((call) => call[1].body);
  expect(bodies.join()).not.toMatch(/PRIVATE_|fixture-secret|tool-1/);
  const spans = bodies.flatMap(
    (body) => JSON.parse(body).resourceSpans[0].scopeSpans[0].spans,
  );
  expect(spans.map((span) => span.name).sort()).toEqual([
    "amp.agent",
    "amp.tool",
    "amp.usage",
  ]);
  expect(
    BigInt(spans[0].endTimeUnixNano) - BigInt(spans[0].startTimeUnixNano),
  ).toBe(100_000_000n);
  const usage = spans.find((span) => span.name === "amp.usage");
  expect(usage.attributes).toContainEqual({
    key: "gen_ai.usage.input_tokens",
    value: { intValue: "15" },
  });
  expect(send.mock.calls[0][0]).toBe(
    "https://ingest.example.invalid/v1/traces",
  );
  expect(send.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { Authorization: "Bearer fixture-secret" },
  });
});
it("recognizes OTLP partial success without retrying accepted spans or exposing server diagnostics", async () => {
  enable();
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response(
        '{"partialSuccess":{"rejectedSpans":"1","errorMessage":"PRIVATE_SERVER_ERROR"}}',
      ),
    );
  vi.stubGlobal("fetch", send);
  const { handlers, logger } = plugin();
  const event = { thread: { id: "thread" }, id: "turn" };
  handlers.get("agent.start")?.(event);
  await handlers.get("agent.end")?.({ ...event, status: "done" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(logger.log).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.log.mock.calls)).not.toContain(
    "PRIVATE_SERVER_ERROR",
  );
});

it("bounds failed exports and never rejects tool execution or leaks network errors", async () => {
  enable();
  const send = vi.fn().mockRejectedValue(new Error("PRIVATE_NETWORK_ERROR"));
  vi.stubGlobal("fetch", send);
  const { handlers, logger } = plugin();
  const event = { thread: { id: "thread" }, id: "turn" };
  handlers.get("agent.start")?.(event);
  await handlers.get("agent.end")?.({ ...event, status: "cancelled" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(logger.log.mock.calls)).not.toMatch(
    /PRIVATE_|fixture-secret/,
  );
  expect(handlers.get("tool.call")?.({ ...event, toolUseID: "tool" })).toEqual({
    action: "allow",
  });
});
