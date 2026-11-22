import { appendFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { registerHindsightStatus } from "./hindsight.ts";

const warning = "Hindsight ⚠ insufficient credits";
const statusKey = "hindsight-retain";

async function withSession(
  test: (fixture: ReturnType<typeof createSession>) => Promise<void>,
  options?: { hasUI?: boolean; hasHindsight?: boolean },
) {
  const fixture = createSession(options);
  try {
    await test(fixture);
  } finally {
    fixture.emit("session_shutdown");
    vi.unstubAllEnvs();
    rmSync(fixture.dir, { force: true, recursive: true });
  }
}

function createSession({ hasUI = true, hasHindsight = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "factory-hindsight-status-"));
  const log = join(dir, "diag.jsonl");
  vi.stubEnv("HINDSIGHT_DIAG_FILE", log);
  const setStatus = vi.fn();
  type Handler = (event: unknown, ctx: ExtensionContext) => void;
  const on = vi.fn<(event: string, handler: Handler) => void>();
  registerHindsightStatus({
    on,
    getAllTools: () => (hasHindsight ? [{ name: "hindsight_diagnose" }] : []),
  } as unknown as ExtensionAPI);
  const ctx = {
    hasUI,
    sessionManager: { getSessionId: () => "current" },
    ui: { setStatus, theme: { fg: (_color: string, text: string) => text } },
  } as unknown as ExtensionContext;
  return {
    dir,
    log,
    setStatus,
    emit(event: string) {
      for (const [name, handler] of on.mock.calls) {
        if (name === event) handler({}, ctx);
      }
    },
    append(event: string, extra: Record<string, unknown> = {}) {
      appendFileSync(
        log,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          harness: "pi",
          event,
          session: "current",
          ...extra,
        })}\n`,
      );
    },
  };
}

const blocked = {
  error: "POST https://example.test/retain -> 402 Payment Required",
};

it("warns on a new blocked automatic write and clears on subsequent retain success", async () => {
  await withSession(async ({ append, emit, setStatus }) => {
    emit("session_start");
    append("retain_failed", blocked);
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenLastCalledWith(statusKey, warning),
    );
    append("retain_failed", {
      error: "POST /retain -> 500 Internal Server Error",
    });
    append("retain_ok", { session: "another" });
    await delay(50);
    expect(setStatus).toHaveBeenCalledTimes(1);
    append("retain_ok");
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenLastCalledWith(statusKey, undefined),
    );
    expect(setStatus).toHaveBeenCalledTimes(2);
  });
});

it("ignores stale, unrelated, and malformed diagnostics and survives log rotation", async () => {
  await withSession(async ({ append, emit, log, setStatus }) => {
    append("retain_failed", { ...blocked, ts: "2025-01-01T00:00:00.000Z" });
    emit("session_start");
    append("retain_failed", { ...blocked, session: "another" });
    append("retain_failed", { ...blocked, harness: "codex" });
    append("recall_failed", blocked);
    append("retain_failed", { error: "unrelated reference 402" });
    await delay(50);
    expect(setStatus).not.toHaveBeenCalled();
    renameSync(log, `${log}.1`);
    append("retain_failed", { error: "Insufficient credits: $0.03 available" });
    appendFileSync(log, "malformed\n");
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenLastCalledWith(statusKey, warning),
    );
    emit("session_shutdown");
    append("retain_ok");
    expect(setStatus.mock.calls).toEqual([
      [statusKey, warning],
      [statusKey, undefined],
    ]);
  });
});

it.each([{ hasUI: false }, { hasHindsight: false }])(
  "does not warn outside an interactive Hindsight session (%j)",
  async (options) => {
    await withSession(async ({ append, emit, setStatus }) => {
      emit("session_start");
      append("retain_failed", blocked);
      await delay(50);
      expect(setStatus).not.toHaveBeenCalled();
    }, options);
  },
);
