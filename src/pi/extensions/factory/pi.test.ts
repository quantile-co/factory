import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as repositories from "./git.ts";
import { type Dependencies, registerPi, startWorktree } from "./pi.ts";

let base: string;
let primary: string;
let child: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "factory-pi-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(base, "pi"));
  vi.stubEnv("PI_HERDR_WORKTREE_ROOT", "");
  primary = join(base, "primary checkout");
  child = join(base, "child checkout");
  mkdirSync(primary);
  git(primary, "init", "-q", "-b", "main");
  writeFileSync(join(primary, "file.txt"), "original\n");
  git(primary, "add", "file.txt");
  git(
    primary,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  git(primary, "worktree", "add", "-qb", "task", child);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(base, { recursive: true, force: true });
});

function dependencies(): Dependencies {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected dependency call");
  };
  return {
    git: repositories,
    terminal: { run: unexpected },
    herdr: {
      available: () => true,
      inventory: vi.fn(async () => {}),
      changed: vi.fn(async () => {}),
      clear: vi.fn(),
      reconcile: unexpected,
      openWorktree: unexpected,
      inspectWorkspace: unexpected,
      startAgent: unexpected,
      waitForSession: unexpected,
      promptAgent: unexpected,
    },
  };
}
function adapter(deps: Dependencies) {
  const events = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const tools = new Map<string, ToolDefinition>();
  registerPi(
    {
      on: (name: string, callback: never) => events.set(name, callback),
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    deps,
  );
  return { events, tools };
}

it("gates owned tools, requests approval and pauses on drift; routes only relevant lifecycle events", async () => {
  const deps = dependencies();
  const { events } = adapter(deps);
  const confirm = vi.fn().mockResolvedValue(false);
  const ctx = {
    cwd: child,
    mode: "tui",
    hasUI: true,
    ui: { confirm },
  } as unknown as ExtensionContext;
  const call = (toolName: string, input: Record<string, unknown>) =>
    events.get("tool_call")?.(
      {
        type: "tool_call",
        toolCallId: "probe",
        toolName,
        input,
      },
      ctx,
    );
  expect(
    await call("personal.foreground_terminal", {
      command: "git switch feature",
      cwd: primary,
    }),
  ).toBeUndefined();
  expect(
    await call("foreground_terminal", {
      command: "gh pr checkout 12",
      cwd: primary,
    }),
  ).toMatchObject({ block: true });
  expect(
    await call("bash", { command: `git -C '${primary}' pull --ff-only` }),
  ).toMatchObject({ block: true });
  confirm.mockResolvedValueOnce(true);
  expect(
    await call("bash", { command: `git -C '${primary}' pull --ff-only` }),
  ).toBeUndefined();
  await events.get("tool_result")?.({ toolName: "personal.bash" }, ctx);
  expect(deps.herdr.changed).not.toHaveBeenCalled();
  await events.get("tool_result")?.({ toolName: "foreground_terminal" }, ctx);
  expect(deps.herdr.changed).toHaveBeenCalledOnce();
  await events.get("agent_start")?.({}, { ...ctx, mode: "rpc" });
  expect(deps.herdr.inventory).not.toHaveBeenCalled();
  git(primary, "switch", "-c", "unexpected");
  expect(await call("bash", { command: "echo inspect" })).toMatchObject({
    block: true,
    reason: expect.stringContaining("unexpected"),
  });
  expect(git(primary, "branch", "--show-current")).toBe("unexpected");
});

it("uses local placement, forks safely, and never replaces an occupied agent", async () => {
  const deps = dependencies();
  writeFileSync(join(base, "AGENTS.md"), "Local navigation\n");
  git(primary, "config", "pi.herdrWorktreeRoot", "../.worktrees");
  const parent = SessionManager.create(primary, join(base, "sessions"));
  parent.appendMessage({
    role: "user",
    content: "Implement the change",
    timestamp: Date.now(),
  });
  parent.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "launch", name: "herdr_worktree", arguments: {} },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  const parentFile = parent.getSessionFile() as string;
  const before = readFileSync(parentFile, "utf8");
  const leaf = parent.getLeafId();
  const ctx = {
    cwd: primary,
    mode: "tui",
    sessionManager: parent,
  } as unknown as ExtensionContext;
  let occupied = false;
  deps.herdr.openWorktree = async ({ path, branch, existing }) => {
    if (!existing) git(primary, "worktree", "add", "-qb", branch, path, "main");
    return "child";
  };
  deps.herdr.inspectWorkspace = async () => ({ pane: "child:p1", occupied });
  deps.herdr.startAgent = vi.fn(async () => {
    occupied = true;
  });
  let ready = false;
  deps.herdr.waitForSession = vi.fn(async () => {
    expect(occupied).toBe(true);
    ready = true;
  });
  deps.herdr.promptAgent = vi.fn(async () => {
    expect(ready).toBe(true);
  });
  writeFileSync(join(primary, "file.txt"), "uncommitted\n");
  const result = await startWorktree(
    { branch: "feature/test", task: "Implement it" },
    ctx,
    "launch/1",
    deps,
  );
  expect(result.started).toBe(true);
  expect(result.path.startsWith(join(base, ".worktrees"))).toBe(true);
  expect(readFileSync(join(result.path, "file.txt"), "utf8")).toBe(
    "original\n",
  );
  expect(readFileSync(parentFile, "utf8")).toBe(before);
  expect(parent.getLeafId()).toBe(leaf);
  expect(git(primary, "branch", "--show-current")).toBe("main");
  const fork = SessionManager.open(result.session as string);
  expect(fork.getCwd()).toBe(result.path);
  expect(
    fork
      .getBranch()
      .some(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      ),
  ).toBe(false);
  expect(deps.herdr.startAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "pi",
      args: ["--session", result.session],
    }),
    undefined,
  );
  expect(
    (
      await startWorktree(
        { branch: "feature/test", task: "Don't duplicate" },
        ctx,
        "launch",
        deps,
      )
    ).started,
  ).toBe(false);
  expect(deps.herdr.startAgent).toHaveBeenCalledOnce();
  expect(deps.herdr.waitForSession).toHaveBeenCalledOnce();
  expect(deps.herdr.promptAgent).toHaveBeenCalledOnce();
  expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(false);
  vi.stubEnv("PI_HERDR_WORKTREE_ROOT", join(tmpdir(), "outside-family"));
  await expect(
    startWorktree(
      { branch: "other", task: "Test", context: "fresh" },
      ctx,
      "launch",
      deps,
    ),
  ).rejects.toThrow(/loses local guidance/);
});

it("refuses concurrent launches and preserves partial results on startup failure", async () => {
  const deps = dependencies();
  const ctx = { cwd: primary, mode: "tui" } as ExtensionContext;
  const options = {
    branch: "new-task",
    task: "Test",
    context: "fresh" as const,
  };
  const lock = join(primary, ".git/pi-herdr-worktree.lock");
  mkdirSync(lock);
  await expect(startWorktree(options, ctx, "launch", deps)).rejects.toThrow(
    /Another worktree launch/,
  );
  rmSync(lock, { recursive: true });
  let created = "";
  deps.herdr.openWorktree = async ({ path, branch }) => {
    created = path;
    git(primary, "worktree", "add", "-qb", branch, path);
    return "partial";
  };
  deps.herdr.inspectWorkspace = async () => ({
    pane: "partial:p1",
    occupied: false,
  });
  deps.herdr.startAgent = vi.fn(async () => {
    throw new Error("agent startup timed out");
  });
  deps.herdr.promptAgent = vi.fn(async () => {});
  await expect(startWorktree(options, ctx, "launch", deps)).rejects.toThrow(
    /Workspace partial.*preserved/,
  );
  expect(deps.herdr.startAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "pi",
      args: ["--session-id", expect.any(String)],
    }),
    undefined,
  );
  expect(deps.herdr.promptAgent).not.toHaveBeenCalled();
  expect(existsSync(created)).toBe(true);
  expect(existsSync(lock)).toBe(false);
  expect(git(primary, "branch", "--show-current")).toBe("main");
});

it.each(["readiness", "submission"])(
  "preserves a launched child after %s failure without resending",
  async (failure) => {
    const deps = dependencies();
    const ctx = { cwd: primary, mode: "tui" } as ExtensionContext;
    let occupied = false;
    deps.herdr.openWorktree = async () => "existing";
    deps.herdr.inspectWorkspace = async () => ({
      pane: "existing:p1",
      occupied,
    });
    deps.herdr.startAgent = vi.fn(async () => {
      occupied = true;
    });
    deps.herdr.waitForSession = vi.fn(async () => {
      if (failure === "readiness") throw new Error("session startup timed out");
    });
    deps.herdr.promptAgent = vi.fn(async () => {
      throw new Error("agent_prompt_stalled");
    });
    const options = {
      branch: "task",
      task: "Implement it",
      context: "fresh" as const,
    };
    await expect(startWorktree(options, ctx, "launch", deps)).rejects.toThrow(
      /Workspace existing.*preserved/,
    );
    expect(existsSync(child)).toBe(true);
    expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(
      false,
    );
    expect(deps.herdr.promptAgent).toHaveBeenCalledTimes(
      failure === "readiness" ? 0 : 1,
    );
    expect((await startWorktree(options, ctx, "retry", deps)).started).toBe(
      false,
    );
    expect(deps.herdr.startAgent).toHaveBeenCalledOnce();
    expect(deps.herdr.waitForSession).toHaveBeenCalledOnce();
    expect(deps.herdr.promptAgent).toHaveBeenCalledTimes(
      failure === "readiness" ? 0 : 1,
    );
  },
);

it("adapts the injected terminal to Pi and refuses handoff outside TUI or after cancellation", async () => {
  const deps = dependencies();
  deps.terminal.run = vi.fn(async () => ({ exitCode: 7, signal: null }));
  const { tools } = adapter(deps);
  const foreground = tools.get("foreground_terminal") as ToolDefinition;
  const screen = { stop() {}, start() {}, requestRender() {} };
  const ctx = {
    cwd: primary,
    mode: "tui",
    ui: {
      custom: (
        build: (
          surface: typeof screen,
          theme: unknown,
          keys: unknown,
          done: (value: unknown) => void,
        ) => unknown,
      ) =>
        new Promise((done) => {
          build(screen, undefined, undefined, done);
        }),
    },
  } as unknown as ExtensionToolContext;
  const result = await foreground.execute(
    "run",
    { command: "test", cwd: "subdir" },
    undefined,
    undefined,
    ctx,
  );
  expect(deps.terminal.run).toHaveBeenCalledWith(
    "test",
    expect.objectContaining({ cwd: join(primary, "subdir"), screen }),
  );
  expect(result).toMatchObject({ isError: true, details: { exitCode: 7 } });
  await expect(
    foreground.execute("rpc", { command: "test" }, undefined, undefined, {
      ...ctx,
      mode: "rpc",
    }),
  ).rejects.toThrow(/interactive Pi/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    foreground.execute(
      "cancel",
      { command: "test" },
      controller.signal,
      undefined,
      ctx,
    ),
  ).rejects.toThrow(/abort/i);
  expect(deps.terminal.run).toHaveBeenCalledOnce();
});
