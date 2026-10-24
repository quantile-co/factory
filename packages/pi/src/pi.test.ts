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
  git(primary, "remote", "add", "origin", join(base, "remote.git"));
  git(primary, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(primary, "branch", "--set-upstream-to=origin/main", "main");
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
    traceClassifier: () => undefined,
    selectChild: vi.fn(async () => ({
      provider: "openai-codex",
      model: "gpt-6.1-sol",
      thinking: "high",
      api: "openai-codex-responses",
      contextWindow: 500000,
      authSource: "stored",
      oauth: true,
      disposition: "inherit",
      reason: "test",
    })),
    git: repositories,
    direnv: { trust: vi.fn(async () => {}) },
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
function adapter(deps: Dependencies, flag?: string, manager?: SessionManager) {
  const events = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const tools = new Map<string, ToolDefinition>();
  registerPi(
    {
      on: (name: string, callback: never) => events.set(name, callback),
      registerFlag: vi.fn(),
      getFlag: () => flag,
      appendEntry: (type: string, data: unknown) =>
        manager?.appendCustomEntry(type, data),
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    deps,
  );
  return { events, tools };
}

async function startup(args: string[], cwd: string, deps = dependencies()) {
  const session = args.includes("--session")
    ? SessionManager.open(args[args.indexOf("--session") + 1])
    : SessionManager.create(cwd, join(base, "child-sessions"), {
        id: args[args.indexOf("--session-id") + 1],
      });
  const receipt = args[args.indexOf("--factory-child-receipt") + 1];
  const { events } = adapter(deps, receipt, session);
  await events.get("session_start")?.({ reason: "startup" }, {
    cwd,
    mode: "tui",
    sessionManager: session,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext);
  return session.getSessionFile() as string;
}

it("gates owned tools without prompting for verified syncs and pauses on drift", async () => {
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
  ).toBeUndefined();
  expect(
    await events.get("tool_call")?.(
      {
        toolName: "foreground_terminal",
        input: { command: `git -C '${primary}' merge --ff-only origin/main` },
      },
      { ...ctx, mode: "rpc", hasUI: false },
    ),
  ).toBeUndefined();
  await events.get("user_bash")?.(
    { command: `git -C '${primary}' pull --ff-only origin main` },
    ctx,
  );
  expect(confirm).not.toHaveBeenCalled();
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
  let reported = "";
  deps.herdr.startAgent = vi.fn(async ({ args }) => {
    occupied = true;
    const file = args[args.indexOf("--session") + 1];
    reported = await startup(args, SessionManager.open(file).getCwd());
  });
  let ready = false;
  deps.herdr.waitForSession = vi.fn(async (_name, confirm) => {
    expect(occupied).toBe(true);
    expect(deps.direnv.trust).toHaveBeenCalledWith(
      primary,
      expect.any(String),
      undefined,
    );
    ready = confirm(reported);
    expect(ready).toBe(true);
    return reported;
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
  expect(fork.buildSessionContext()).toMatchObject({
    model: { provider: "openai-codex", modelId: "gpt-6.1-sol" },
    thinkingLevel: "high",
  });
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
      args: [
        "--session",
        result.session,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-6.1-sol",
        "--thinking",
        "high",
        "--factory-child-receipt",
        expect.any(String),
      ],
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
  expect(deps.selectChild).toHaveBeenCalledOnce();
  expect(deps.direnv.trust).toHaveBeenCalledOnce();
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

it("preserves a worktree without starting Pi when environment trust fails", async () => {
  const deps = dependencies();
  deps.herdr.openWorktree = async () => "unapproved";
  deps.herdr.inspectWorkspace = async () => ({
    pane: "unapproved:p1",
    occupied: false,
  });
  deps.direnv.trust = vi.fn(async () => {
    throw new Error("Approve primary environment first");
  });
  deps.herdr.startAgent = vi.fn(async () => {});
  deps.herdr.promptAgent = vi.fn(async () => {});
  await expect(
    startWorktree(
      { branch: "task", task: "Test", context: "fresh" },
      { cwd: primary, mode: "tui" } as ExtensionContext,
      "launch",
      deps,
    ),
  ).rejects.toThrow(/Approve primary.*Workspace unapproved.*preserved/);
  expect(deps.herdr.startAgent).not.toHaveBeenCalled();
  expect(deps.herdr.promptAgent).not.toHaveBeenCalled();
  expect(existsSync(child)).toBe(true);
  expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(false);
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
      args: [
        "--session-id",
        expect.any(String),
        "--provider",
        "openai-codex",
        "--model",
        "gpt-6.1-sol",
        "--thinking",
        "high",
        "--factory-child-receipt",
        expect.any(String),
      ],
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
    let reported = "";
    deps.herdr.startAgent = vi.fn(async ({ args }) => {
      occupied = true;
      reported = await startup(args, child);
    });
    deps.herdr.waitForSession = vi.fn(async (_name, confirm) => {
      if (failure === "readiness") throw new Error("session startup timed out");
      expect(confirm(reported)).toBe(true);
      return reported;
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

it.each([
  "match",
  "model",
  "thinking",
  "authSource",
  "unavailable",
  "old-child",
  "session",
])(
  "verifies fresh child runtime before task delivery: %s",
  async (caseName) => {
    const deps = dependencies();
    const childDeps = dependencies();
    const actual = await childDeps.selectChild({}, {} as ExtensionContext);
    if (["model", "thinking", "authSource"].includes(caseName))
      Object.assign(actual, { [caseName]: "different" });
    childDeps.selectChild = vi.fn(async () => {
      if (caseName === "unavailable")
        throw new Error("private error must not leak");
      return actual;
    });
    deps.herdr.openWorktree = async () => "existing";
    deps.herdr.inspectWorkspace = async () => ({
      pane: "existing:p1",
      occupied: false,
    });
    let reported = "/missing/old-session.jsonl";
    let receipt = "";
    deps.herdr.startAgent = vi.fn(async ({ args }) => {
      receipt = args[args.indexOf("--factory-child-receipt") + 1];
      if (caseName !== "old-child") {
        reported = await startup(args, child, childDeps);
        // A fresh native session has no conversation yet; verification must not need one.
        expect(existsSync(reported)).toBe(false);
        expect(readFileSync(receipt, "utf8")).not.toContain("private error");
      }
    });
    deps.herdr.waitForSession = vi.fn(async (_name, confirm) => {
      if (
        !confirm(caseName === "session" ? "/different/session.jsonl" : reported)
      )
        throw new Error(
          "Child must load compatible Factory startup verification; no task prompt was sent.",
        );
      return reported;
    });
    deps.herdr.promptAgent = vi.fn(async () => {});
    const run = startWorktree(
      {
        branch: "task",
        task: "Safe bounded task instructions",
        context: "fresh",
      },
      { cwd: primary, mode: "tui" } as ExtensionContext,
      "launch",
      deps,
    );
    if (caseName === "match")
      expect(await run).toMatchObject({ started: true, selection: actual });
    else await expect(run).rejects.toThrow(/no task prompt was sent/);
    expect(deps.herdr.promptAgent).toHaveBeenCalledTimes(
      caseName === "match" ? 1 : 0,
    );
    expect(existsSync(receipt)).toBe(false);
    expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(
      false,
    );
  },
);

it("late startup cannot put its receipt in a subsequent launch's lock", async () => {
  const deps = dependencies();
  const ctx = { cwd: primary, mode: "tui" } as ExtensionContext;
  let cwd = child;
  let oldArgs: string[] = [];
  let reported = "";
  deps.herdr.openWorktree = async ({ path, branch, existing }) => {
    cwd = path;
    if (!existing) git(primary, "worktree", "add", "-qb", branch, path);
    return "workspace";
  };
  deps.herdr.inspectWorkspace = async () => ({
    pane: "workspace:p1",
    occupied: false,
  });
  deps.herdr.startAgent = vi.fn(async ({ args }) => {
    if (!oldArgs.length) {
      oldArgs = args;
      return;
    }
    await expect(startup(oldArgs, child)).rejects.toThrow(/ENOENT/);
    reported = await startup(args, cwd);
  });
  deps.herdr.waitForSession = vi.fn(async (_name, confirm) => {
    if (!reported) throw new Error("startup timed out");
    expect(confirm(reported)).toBe(true);
    return reported;
  });
  deps.herdr.promptAgent = vi.fn(async () => {});
  await expect(
    startWorktree(
      { branch: "task", task: "Test", context: "fresh" },
      ctx,
      "first",
      deps,
    ),
  ).rejects.toThrow(/timed out/);
  expect(
    (
      await startWorktree(
        { branch: "other-task", task: "Test", context: "fresh" },
        ctx,
        "second",
        deps,
      )
    ).started,
  ).toBe(true);
  expect(deps.herdr.promptAgent).toHaveBeenCalledOnce();
  expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(false);
});

it("selection failures and cancellation abort spawning, while reconciliation never selects", async () => {
  const deps = dependencies();
  deps.herdr.openWorktree = async () => "existing";
  deps.herdr.inspectWorkspace = async () => ({
    pane: "existing:p1",
    occupied: false,
  });
  deps.herdr.startAgent = vi.fn();
  deps.herdr.promptAgent = vi.fn();
  const selection = await deps.selectChild({}, {} as ExtensionContext);
  const controller = new AbortController();
  deps.selectChild = vi.fn(async () => {
    throw new Error("Unavailable explicit model");
  });
  const ctx = { cwd: primary, mode: "tui" } as ExtensionContext;
  const options = { branch: "task", task: "Test", context: "fresh" as const };
  await expect(startWorktree(options, ctx, "invalid", deps)).rejects.toThrow(
    /Unavailable explicit model/,
  );
  deps.selectChild = vi.fn(async () => {
    controller.abort();
    return selection;
  });
  await expect(
    startWorktree(
      options,
      { ...ctx, signal: controller.signal },
      "cancel",
      deps,
    ),
  ).rejects.toThrow(/abort/i);
  expect(deps.herdr.startAgent).not.toHaveBeenCalled();
  expect(deps.herdr.promptAgent).not.toHaveBeenCalled();
  expect(existsSync(join(primary, ".git/pi-herdr-worktree.lock"))).toBe(false);
  deps.selectChild = vi.fn();
  deps.herdr.reconcile = vi.fn(async () => ({
    repos: 1,
    opened: 0,
    closed: 0,
    skipped: 0,
    failed: 0,
  }));
  const { tools } = adapter(deps);
  await tools
    .get("herdr_worktree")
    ?.execute(
      "reconcile",
      { action: "reconcile" },
      undefined,
      undefined,
      ctx as ExtensionToolContext,
    );
  expect(deps.selectChild).not.toHaveBeenCalled();
});

it("returns classifier usage through native tool results even on launch failure, and deduplicates roster warnings", async () => {
  const deps = dependencies();
  const selection = await deps.selectChild({}, {} as ExtensionContext);
  const usage = {
    input: 5,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 6,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  deps.selectChild = vi.fn(async () => ({
    ...selection,
    usage,
    warning: "Review changed routing roster",
  }));
  deps.herdr.openWorktree = async () => "existing";
  deps.herdr.inspectWorkspace = async () => ({
    pane: "existing:p1",
    occupied: false,
  });
  let reported = "";
  deps.herdr.startAgent = vi.fn(async ({ args }) => {
    reported = await startup(args, child);
  });
  deps.herdr.waitForSession = vi.fn(async (_name, confirm) => {
    expect(confirm(reported)).toBe(true);
    return reported;
  });
  deps.herdr.promptAgent = vi.fn(async () => {});
  const { tools } = adapter(deps);
  const tool = tools.get("herdr_worktree") as ToolDefinition;
  const notify = vi.fn();
  const ctx = {
    cwd: primary,
    mode: "tui",
    ui: { notify },
  } as unknown as ExtensionToolContext;
  const params = {
    action: "start",
    branch: "task",
    task: "Test",
    context: "fresh",
  };
  for (let i = 0; i < 2; i++) {
    const result = await tool.execute(
      "launch",
      params,
      undefined,
      undefined,
      ctx,
    );
    expect(result).toMatchObject({
      usage,
      details: { selection: { ...selection, usage } },
    });
  }
  expect(notify).toHaveBeenCalledExactlyOnceWith(
    "Review changed routing roster",
    "warning",
  );
  deps.herdr.startAgent = vi.fn(async () => {
    throw new Error("startup failed");
  });
  expect(
    await tool.execute("launch", params, undefined, undefined, ctx),
  ).toMatchObject({
    isError: true,
    usage,
    details: { selection: { ...selection, usage } },
  });
});

it("accounts traced usage once on direct and nested results, preserving unrelated usage even when launch fails", async () => {
  const deps = dependencies();
  const selection = await deps.selectChild({}, {} as ExtensionContext);
  const usage = {
    input: 10,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 11,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  deps.traceClassifier = vi.fn(() => () => {});
  deps.selectChild = async (_options, _ctx, _signal, observe) => {
    observe?.()?.({
      provider: "typesafe",
      model: "jev-latest",
      api: "typesafe-system-one",
      timestamp: 0,
      stopReason: "stop",
      answers: {},
      usage,
    });
    return { ...selection, usage };
  };
  deps.herdr.openWorktree = async () => "existing";
  deps.herdr.inspectWorkspace = async () => ({
    pane: "existing:p1",
    occupied: false,
  });
  deps.herdr.startAgent = async () => {
    throw new Error("startup failed");
  };
  const { events, tools } = adapter(deps);
  const tool = tools.get("herdr_worktree") as ToolDefinition;
  const session = SessionManager.create(primary, join(base, "sessions"));
  const ctx = {
    cwd: primary,
    mode: "tui",
    ui: { notify: vi.fn() },
    sessionManager: session,
    isProjectTrusted: () => false,
  } as unknown as ExtensionToolContext;
  const emit = (name: string, event: unknown) => events.get(name)?.(event, ctx);
  const run = async (id: string, parentToolCallId?: string) => {
    await emit("tool_execution_start", { toolCallId: id, parentToolCallId });
    const result = await tool.execute(
      id,
      {
        action: "start",
        branch: "task",
        task: "Test",
        context: "fresh",
      },
      undefined,
      undefined,
      ctx,
    );
    expect(result).toMatchObject({
      isError: true,
      details: { selection: { usage } },
    });
    // Neither the plugin nor Pi's nested recorder sees a second copy of our usage.
    expect(result.usage).toBeUndefined();
    await emit("tool_execution_end", { toolCallId: id, result });
  };
  await emit("tool_execution_start", { toolCallId: "outer" });
  await emit("tool_execution_start", {
    toolCallId: "wrapper",
    parentToolCallId: "outer",
  });
  await run("nested-1", "wrapper");
  await run("nested-2", "wrapper");
  await emit("tool_execution_end", { toolCallId: "wrapper" });
  // Another root can finish while the enclosing codemode result is still pending.
  await run("direct");
  expect(deps.traceClassifier).toHaveBeenLastCalledWith({
    sessionId: session.getSessionId(),
    toolCallId: "direct",
  });
  const direct = {
    role: "toolResult",
    toolCallId: "direct",
    content: [],
    isError: true,
  };
  expect(await emit("message_end", { message: direct })).toEqual({
    message: { ...direct, usage },
  });
  const otherUsage = {
    ...usage,
    input: 30,
    output: 5,
    totalTokens: 35,
    reasoning: 2,
    cost: { ...usage.cost, input: 0.1, total: 0.1 },
  };
  await emit("tool_execution_end", {
    toolCallId: "outer",
    result: { usage: otherUsage },
  });
  const outer = {
    role: "toolResult",
    toolCallId: "outer",
    content: [],
    usage: otherUsage,
  };
  expect(await emit("message_end", { message: outer })).toEqual({
    message: {
      ...outer,
      usage: { ...otherUsage, input: 50, output: 7, totalTokens: 57 },
    },
  });
  expect(await emit("message_end", { message: outer })).toBeUndefined();
});

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
