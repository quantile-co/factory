import { exportSpans } from "@quantile-co/factory-otel/otlp";
import { afterEach, expect, it, vi } from "vitest";
import plugin, { type AmpPlugin } from "./plugin.ts";
import type { TelemetryPlugin } from "./telemetry.ts";

vi.mock("@quantile-co/factory-otel/otlp", async (original) => ({
  ...(await original<object>()),
  exportSpans: vi.fn(async () => true),
}));
const activity = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => {
  const { promisify } = await import("node:util");
  return {
    ...(await original<object>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: activity }),
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function inventory(agent_status?: string, agent = "pi") {
  activity.mockResolvedValue({
    stdout: JSON.stringify({
      result: {
        type: "agent_list",
        agents: agent_status ? [{ agent, agent_status }] : [],
      },
    }),
  });
}

async function fixture(
  orb = true,
  kind: AmpPlugin["system"]["executor"]["kind"] = "remote",
  failure?: "keep-awake" | "telemetry",
) {
  vi.stubEnv("AMP_ORB", orb ? "1" : undefined);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  activity.mockReset();
  inventory();
  const release = vi.fn();
  const acquire = vi.fn(async () => ({ unsubscribe: release }));
  const commands = new Map<
    string,
    Parameters<AmpPlugin["registerCommand"]>[2]
  >();
  const log = vi.fn();
  const handlers = new Map<string, Parameters<TelemetryPlugin["on"]>[1]>();
  plugin({
    system: { executor: { kind, keepAlive: acquire } },
    logger: { log },
    registerCommand: (name, _options, action) => {
      if (failure === "keep-awake")
        throw new Error("command registration failed");
      return commands.set(name, action);
    },
    on: (name: string, handler: Parameters<TelemetryPlugin["on"]>[1]) => {
      if (failure === "telemetry") throw new Error("event registration failed");
      return handlers.set(name, handler);
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  const select = (mode: string) => {
    const command = commands.get(`factory-orb-awake-${mode}`);
    if (!command) throw new Error(`Missing command: ${mode}`);
    return command({ ui: { notify: vi.fn(async () => {}) } });
  };
  return { acquire, release, commands, handlers, log, select };
}

it("registers both capabilities through one plugin and exports native spans locally", async () => {
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "https://collector.example");
  const f = await fixture();
  expect(f.commands.size).toBe(3);
  expect([...f.handlers.keys()]).toEqual([
    "agent.start",
    "tool.call",
    "tool.result",
    "agent.end",
  ]);
  const event = {
    thread: { id: "T-12345678-1234-1234-1234-123456789abc" },
    id: "turn",
  };
  f.handlers.get("agent.start")?.(event);
  await f.handlers.get("agent.end")?.(event);
  expect(exportSpans).toHaveBeenCalledWith(
    { endpoint: "http://127.0.0.1:4318" },
    expect.objectContaining({ "service.name": "factory-amp" }),
    "factory.amp",
    expect.any(Array),
    2,
  );
  await f.select("on");
  expect(f.acquire).toHaveBeenCalledOnce();
});

it("keeps telemetry active when keep-awake initialization fails", async () => {
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "https://collector.example");
  const f = await fixture(true, "remote", "keep-awake");
  expect(f.handlers.size).toBe(4);
  expect(f.commands.size).toBe(0);
  expect(f.log).toHaveBeenCalledWith(
    "Factory keep-awake initialization unavailable.",
  );
});

it("keeps keep-awake active when telemetry initialization fails", async () => {
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", "https://collector.example");
  const f = await fixture(true, "remote", "telemetry");
  expect(f.commands.size).toBe(3);
  await f.select("on");
  expect(f.acquire).toHaveBeenCalledOnce();
  expect(f.log).toHaveBeenCalledWith(
    "Factory telemetry initialization unavailable.",
  );
});

it("keeps keep-awake available when telemetry is disabled", async () => {
  vi.stubEnv("QUANTILE_OTLP_ENDPOINT", undefined);
  const f = await fixture();
  expect(f.commands.size).toBe(3);
  expect(f.handlers.size).toBe(0);
  await f.select("on");
  expect(f.acquire).toHaveBeenCalledOnce();
});

it("observes only local Pi activity and releases after idle grace", async () => {
  const f = await fixture();
  expect(f.acquire).not.toHaveBeenCalled();
  expect(activity.mock.calls[0][1]).toEqual([
    "--session",
    "orb",
    "agent",
    "list",
  ]);
  expect(activity.mock.calls[0][2].timeout).toBe(3000);
  expect(activity.mock.calls[0][2].env.HERDR_SOCKET_PATH).toBeUndefined();
  expect(
    activity.mock.calls[0][2].env.HERDR_CLIENT_SOCKET_PATH,
  ).toBeUndefined();
  inventory("working", "codex");
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.acquire).not.toHaveBeenCalled();
  inventory("working");
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  inventory("idle");
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.release).toHaveBeenCalledTimes(1);
});

it.each(["blocked", "exited", "unavailable", "invalid"])(
  "does not hold indefinitely for %s state",
  async (state) => {
    const f = await fixture();
    inventory("working");
    await vi.advanceTimersByTimeAsync(5000);
    if (state === "unavailable")
      activity.mockRejectedValue(new Error("offline"));
    else if (state === "invalid") activity.mockResolvedValue({ stdout: "{}" });
    else inventory(state === "exited" ? undefined : state);
    await vi.advanceTimersByTimeAsync(125000);
    expect(f.acquire).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
  },
);

it("keeps long-running Pi work awake without a runtime cap", async () => {
  const f = await fixture();
  inventory("working");
  await vi.advanceTimersByTimeAsync(5000);
  vi.setSystemTime(48 * 60 * 60 * 1000);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  expect(f.release).not.toHaveBeenCalled();
  inventory("idle");
  await vi.advanceTimersByTimeAsync(125000);
  expect(f.release).toHaveBeenCalledTimes(1);
});

it("serializes explicit On/Off overrides and permits Auto re-arming", async () => {
  const f = await fixture();
  await Promise.all([f.select("on"), f.select("off")]);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  expect(f.release).toHaveBeenCalledTimes(1);
  inventory("working");
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  await f.select("auto");
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.acquire).toHaveBeenCalledTimes(2);
});

it("recovers from an acquisition error without leaking duplicate leases", async () => {
  const f = await fixture();
  f.acquire.mockRejectedValueOnce(new Error("temporarily unavailable"));
  inventory("working");
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.acquire).toHaveBeenCalledTimes(2);
  await f.select("off");
  expect(f.release).toHaveBeenCalledTimes(1);
});

it.each(["local", "remote", "unknown"] as const)(
  "does not treat executor kind %s as proof of an orb",
  async (kind) => {
    const f = await fixture(false, kind);
    await vi.advanceTimersByTimeAsync(10000);
    expect(activity).not.toHaveBeenCalled();
    expect(f.commands.size).toBe(0);
    expect(f.acquire).not.toHaveBeenCalled();
  },
);
