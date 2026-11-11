import { afterEach, expect, it, vi } from "vitest";
import plugin, { type AmpPlugin } from "./plugin.ts";

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

async function fixture(kind = "orb") {
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
  plugin({
    system: { executor: { kind, keepAlive: acquire } },
    logger: { log },
    registerCommand: (name, _options, action) => commands.set(name, action),
  });
  await vi.advanceTimersByTimeAsync(0);
  const select = (mode: string) => {
    const command = commands.get(`factory-orb-awake-${mode}`);
    if (!command) throw new Error(`Missing command: ${mode}`);
    return command({ ui: { notify: vi.fn(async () => {}) } });
  };
  return { acquire, release, commands, log, select };
}

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

it("does not monitor or acquire leases outside an orb", async () => {
  const f = await fixture("local");
  await vi.advanceTimersByTimeAsync(10000);
  expect(activity).not.toHaveBeenCalled();
  expect(f.commands.size).toBe(0);
  expect(f.acquire).not.toHaveBeenCalled();
});
