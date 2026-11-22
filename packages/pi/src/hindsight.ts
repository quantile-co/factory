import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  watch,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const statusKey = "hindsight-retain";
const tailBytes = 64 * 1024;

function readTail(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const file = fstatSync(fd);
    if (!file.isFile()) return "";
    const { size } = file;
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    const length = readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(fd);
  }
}

// Upstream 0.8.7 records outcomes in diagnostic JSONL, formatting HTTP
// failures as "METHOD URL -> STATUS ...". Never display raw diagnostic text.
function latestCreditOutcome(log: string, session: string, since: number) {
  for (const line of log.split("\n").reverse()) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      !(
        "harness" in entry &&
        "session" in entry &&
        "ts" in entry &&
        "event" in entry
      ) ||
      entry.harness !== "pi" ||
      entry.session !== session ||
      typeof entry.ts !== "string" ||
      !(Date.parse(entry.ts) >= since)
    )
      continue;
    if (entry.event === "retain_ok") return "ok";
    if (
      entry.event === "retain_failed" &&
      "error" in entry &&
      typeof entry.error === "string" &&
      /-> 402\b|\binsufficient credits\b/i.test(entry.error)
    )
      return "blocked";
  }
}

export function registerHindsightStatus(api: ExtensionAPI) {
  let stop: (() => void) | undefined;
  api.on("session_start", (_event, ctx) => {
    stop?.();
    stop = undefined;
    if (
      !ctx.hasUI ||
      !api.getAllTools().some(({ name }) => name === "hindsight_diagnose")
    )
      return;

    const path = resolve(
      process.env.HINDSIGHT_DIAG_FILE ||
        join(homedir(), ".hindsight", "coding-agents-logs", "diag.jsonl"),
    );
    const session = ctx.sessionManager.getSessionId();
    const since = Date.now();
    let blocked = false;

    function refresh() {
      let log: string;
      try {
        log = readTail(path);
      } catch {
        // The file may not exist yet, or may be between rotations.
        return;
      }
      const outcome = latestCreditOutcome(log, session, since);
      if (outcome === undefined || blocked === (outcome === "blocked")) return;
      blocked = outcome === "blocked";
      ctx.ui.setStatus(
        statusKey,
        blocked
          ? ctx.ui.theme.fg("warning", "Hindsight ⚠ insufficient credits")
          : undefined,
      );
    }

    try {
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // Watch the directory because upstream replaces the file on rotation.
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename === null || filename === basename(path)) refresh();
      });
      watcher.on("error", () => watcher.close());
      stop = () => {
        watcher.close();
        if (blocked) ctx.ui.setStatus(statusKey, undefined);
      };
    } catch {
      // Diagnostics are optional; Pi must remain usable without them.
      return;
    }
    refresh();
  });
  api.on("session_shutdown", () => {
    stop?.();
    stop = undefined;
  });
}
