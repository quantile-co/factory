import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { run } from "./terminal.ts";

let base: string;
const screen = { stop: vi.fn(), start: vi.fn(), requestRender: vi.fn() };
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "factory-terminal-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(base, { recursive: true, force: true });
});

it("runs in the requested directory and restores the caller's terminal after exit or failed spawn", async () => {
  const cwd = join(base, "task checkout");
  mkdirSync(cwd);
  const options = { cwd, shell: "bash", args: ["-c"], screen };
  const result = await run("pwd > location; exit 7", options);
  expect(readFileSync(join(cwd, "location"), "utf8").trim()).toBe(cwd);
  expect(result).toMatchObject({ exitCode: 7 });
  expect(screen.stop).toHaveBeenCalledOnce();
  expect(screen.start).toHaveBeenCalledOnce();
  expect(screen.requestRender).toHaveBeenCalledWith(true);

  const failure = await run("true", { ...options, cwd: join(base, "missing") });
  expect(failure).toMatchObject({ error: expect.stringContaining("ENOENT") });
  expect(screen.start).toHaveBeenCalledTimes(2);
});

it("does not take over the terminal after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    run("true", {
      cwd: base,
      shell: "bash",
      args: ["-c"],
      screen,
      signal: controller.signal,
    }),
  ).rejects.toThrow(/abort/i);
  expect(screen.stop).not.toHaveBeenCalled();
});
