import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getShellConfig,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

interface Repository {
  primary: string;
  common: string;
  checkouts: { path: string; branch?: string; prunable: boolean }[];
}
interface Reporter {
  warn(message: string): void;
}
interface ForegroundResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export interface Dependencies {
  git: {
    repository(path: string): Promise<Repository | undefined>;
    primaryDrift(repo: Repository): string | undefined;
    validateBranch(
      repo: Repository,
      branch: string,
      base: string,
    ): Promise<void>;
    destination(repo: Repository, branch: string): Promise<string>;
    guardFile(path: string): Promise<void>;
    guardCommand(command: string, cwd: string): Promise<string[]>;
  };
  herdr: {
    available(): boolean;
    inventory(ctx: Reporter): Promise<void>;
    changed(ctx: Reporter): Promise<void>;
    clear(): void;
    reconcile(ctx: Reporter): Promise<{
      repos: number;
      opened: number;
      closed: number;
      skipped: number;
      failed: number;
    }>;
    openWorktree(
      options: {
        primary: string;
        path: string;
        branch: string;
        base: string;
        existing: boolean;
      },
      signal?: AbortSignal,
    ): Promise<string>;
    inspectWorkspace(
      workspace: string,
      signal?: AbortSignal,
    ): Promise<{ pane: string; occupied: boolean }>;
    startAgent(
      options: { name: string; kind: string; pane: string; args: string[] },
      signal?: AbortSignal,
    ): Promise<void>;
    promptAgent(
      name: string,
      prompt: string,
      signal?: AbortSignal,
    ): Promise<void>;
  };
  terminal: {
    run(
      command: string,
      options: {
        cwd: string;
        shell: string;
        args: string[];
        screen: {
          stop(): void;
          start(): void;
          requestRender(force?: boolean): void;
        };
        signal?: AbortSignal;
      },
    ): Promise<ForegroundResult>;
  };
}

export interface StartOptions {
  repository?: string;
  branch?: string;
  base?: string;
  task?: string;
  context?: "fork" | "fresh";
}

function ancestorGuides(checkout: string): string[] {
  const guides: string[] = [];
  let parent = dirname(checkout);
  while (!existsSync(parent)) parent = dirname(parent);
  for (parent = realpathSync(parent); ; parent = dirname(parent)) {
    const names = [
      "AGENTS.override.md",
      "AGENTS.md",
      "AGENTS.MD",
      "CLAUDE.md",
      "CLAUDE.MD",
    ];
    const guide = names.map((name) => join(parent, name)).find(existsSync);
    if (guide) guides.push(realpathSync(guide));
    if (dirname(parent) === parent) return guides;
  }
}

function forkSession(
  ctx: ExtensionContext,
  cwd: string,
  toolCallId: string,
): string {
  const source = ctx.sessionManager.getSessionFile();
  if (!source || !existsSync(source))
    throw new Error(
      "No persisted parent session to fork; choose context: fresh.",
    );
  const branch = ctx.sessionManager.getBranch();
  const launchingTurn = branch.findIndex(
    (entry) =>
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      entry.message.content.some(
        (block) =>
          block.type === "toolCall" &&
          (block.id === toolCallId || toolCallId.startsWith(`${block.id}/`)),
      ),
  );
  const leaf =
    launchingTurn >= 0
      ? branch[launchingTurn - 1]?.id
      : ctx.sessionManager.getLeafId();
  const child = SessionManager.forkFrom(source, cwd);
  if (leaf) child.branch(leaf);
  else child.resetLeaf();
  // Persist the chosen branch without carrying the in-flight tool batch into it.
  child.appendCustomEntry("herdr-worktree-parent", { session: source });
  const path = child.getSessionFile();
  if (!path) throw new Error("Pi did not create a child session.");
  chmodSync(path, 0o600);
  return path;
}

export async function startWorktree(
  options: StartOptions,
  ctx: ExtensionContext,
  toolCallId: string,
  { git, herdr }: Pick<Dependencies, "git" | "herdr">,
  signal?: AbortSignal,
) {
  if (ctx.mode !== "tui" || !herdr.available())
    throw new Error(
      "Starting a child Pi requires an interactive Pi inside Herdr on this host. The Git guard remains active without Herdr.",
    );
  const { branch, task } = options;
  if (!branch || branch === "main" || !task?.trim())
    throw new Error(
      "Provide a task branch other than main and a non-empty task.",
    );
  const repo = await git.repository(
    resolve(ctx.cwd, options.repository ?? "."),
  );
  if (!repo)
    throw new Error(
      "Choose a repository checkout, not a parent workspace directory.",
    );
  const drift = git.primaryDrift(repo);
  if (drift) throw new Error(drift);
  const base = options.base ?? "main";
  await git.validateBranch(repo, branch, base);
  if (options.context !== "fresh" && !ctx.sessionManager.getSessionFile())
    throw new Error("No persisted parent session; choose context: fresh.");

  const lock = join(repo.common, "pi-herdr-worktree.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    throw new Error(
      `Another worktree launch may be active. Inspect ${lock} before retrying; locks are never stolen automatically.`,
      { cause: error },
    );
  }
  let workspace: string | undefined;
  let path: string | undefined;
  try {
    // Re-read under the shared Git-directory lock; different Pi processes share it.
    const current = await git.repository(repo.primary);
    if (!current) throw new Error("Repository disappeared.");
    const changed = git.primaryDrift(current);
    if (changed) throw new Error(changed);
    const existing = current.checkouts.find(
      (checkout) => checkout.branch === branch,
    );
    if (existing?.prunable)
      throw new Error(
        "The branch has a prunable worktree; inspect it before reopening.",
      );
    path = existing?.path ?? (await git.destination(current, branch));
    const inherited = new Set(ancestorGuides(path));
    const missing = ancestorGuides(repo.primary).filter(
      (guide) => !inherited.has(guide),
    );
    if (missing.length)
      throw new Error(
        `Worktree destination ${path} loses local guidance: ${missing.join(", ")}. Configure PI_HERDR_WORKTREE_ROOT or git config --local pi.herdrWorktreeRoot beneath the intended family directory.`,
      );
    if (!existing && existsSync(path))
      throw new Error(
        `Destination already exists: ${path}. Nothing was overwritten.`,
      );
    if (!existing) mkdirSync(dirname(path), { recursive: true });
    workspace = await herdr.openWorktree(
      {
        primary: repo.primary,
        path,
        branch,
        base,
        existing: Boolean(existing),
      },
      signal,
    );
    const { pane, occupied } = await herdr.inspectWorkspace(workspace, signal);
    if (occupied)
      return {
        path,
        workspace,
        pane,
        started: false,
        message:
          "An agent already occupies this worktree. It was not replaced or prompted.",
      };
    const session =
      options.context === "fresh"
        ? undefined
        : forkSession(ctx, path, toolCallId);
    const name = `task-${createHash("sha256").update(`${repo.common}:${branch}`).digest("hex").slice(0, 12)}`;
    await herdr.startAgent(
      {
        name,
        kind: "pi",
        pane,
        args: session ? ["--session", session] : ["--session-id", randomUUID()],
      },
      signal,
    );
    await herdr.promptAgent(
      name,
      `Work in this linked checkout: ${path}. The parent Pi session remains open. Do not switch the primary checkout or create another worktree for this same task.\n\n${task}`,
      signal,
    );
    return {
      path,
      workspace,
      pane,
      session,
      started: true,
      message:
        "Child Pi started without changing parent focus or session. Uncommitted files were not copied.",
    };
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${workspace ? ` Workspace ${workspace} at ${path} was preserved. Inspect it before retrying: startup or prompt delivery may already have happened.` : " No automatic cleanup or retry was attempted."}`,
      { cause: error },
    );
  } finally {
    rmdirSync(lock);
  }
}

export function registerPi(pi: ExtensionAPI, deps: Dependencies) {
  const { git, herdr, terminal } = deps;
  const reporter = (ctx: ExtensionContext): Reporter => ({
    warn: (message) => ctx.ui.notify(message, "warning"),
  });
  const inHerdr = (ctx: ExtensionContext) =>
    ctx.mode === "tui" && herdr.available();

  async function checkBranch(ctx: ExtensionContext) {
    const repo = await git.repository(ctx.cwd);
    const drift = repo && git.primaryDrift(repo);
    if (drift) throw new Error(drift);
  }
  async function shell(command: string, cwd: string, ctx: ExtensionContext) {
    await checkBranch(ctx);
    for (const question of await git.guardCommand(command, cwd)) {
      if (
        !ctx.hasUI ||
        !(await ctx.ui.confirm("Primary checkout maintenance", question))
      )
        throw new Error(
          "Main maintenance was not approved. Use a linked task checkout.",
        );
    }
  }
  pi.on("session_start", async (_event, ctx) => {
    try {
      await checkBranch(ctx);
    } catch (error) {
      ctx.ui.notify(String(error), "warning");
    }
    if (inHerdr(ctx)) await herdr.inventory(reporter(ctx));
  });
  pi.on("agent_start", async (_event, ctx) => {
    if (inHerdr(ctx)) await herdr.inventory(reporter(ctx));
  });
  pi.on("tool_result", async (event, ctx) => {
    if (
      inHerdr(ctx) &&
      ["bash", "foreground_terminal", "herdr_worktree"].includes(event.toolName)
    )
      await herdr.changed(reporter(ctx));
  });
  pi.on("session_shutdown", () => {
    herdr.clear();
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      await checkBranch(ctx);
    } catch (error) {
      return {
        message: {
          customType: "primary-checkout-drift",
          content: String(error),
          display: true,
        },
      };
    }
    return undefined;
  });
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName;
    const input = event.input as Record<string, unknown>;
    try {
      if (tool === "write" || tool === "edit") {
        if (typeof input.path !== "string")
          throw new Error("Cannot resolve file mutation target.");
        await git.guardFile(resolve(ctx.cwd, input.path));
      } else if (tool === "bash" || tool === "foreground_terminal") {
        if (typeof input.command !== "string")
          throw new Error("Cannot inspect shell command.");
        await shell(
          input.command,
          typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd,
          ctx,
        );
      } else if (tool === "powershell") {
        throw new Error(
          "The checkout guard currently supports Bash, not PowerShell. Use Bash or a separately isolated environment.",
        );
      }
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return undefined;
  });
  pi.on("user_bash", async (event, ctx) => {
    await shell(event.command, ctx.cwd, ctx);
    return undefined;
  });

  pi.registerTool({
    name: "herdr_worktree",
    label: "Herdr worktree",
    description:
      "Start Pi in a Git task worktree and native Herdr child workspace without replacing the parent session or focus. Existing occupied workspaces are not prompted again. Can also reconcile Herdr's worktree sidebar.",
    promptSnippet:
      "Create/open a task worktree with a separate Pi session; preserve the primary checkout on main.",
    promptGuidelines: [
      "Before making task changes in a primary checkout, use herdr_worktree with action start, branch and task. Read-only inspection can stay in the primary checkout.",
      "In a linked task checkout, continue there instead of launching another workspace for the same task. A launcher failure may leave a child workspace or agent: inspect before retrying.",
    ],
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("reconcile")]),
      repository: Type.Optional(
        Type.String({
          description: "Checkout path; defaults to the current repository.",
        }),
      ),
      branch: Type.Optional(
        Type.String({
          description: "Task branch, never main. Required for start.",
        }),
      ),
      task: Type.Optional(
        Type.String({
          description:
            "Task instructions for the child Pi. Required for start.",
        }),
      ),
      base: Type.Optional(
        Type.String({
          description: "Starting Git ref for a new branch; defaults to main.",
        }),
      ),
      context: Type.Optional(
        Type.Union([Type.Literal("fork"), Type.Literal("fresh")], {
          description:
            "Fork parent conversation (default), or start fresh. Neither changes the parent.",
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "reconcile" && !inHerdr(ctx))
        throw new Error("Reconciliation requires interactive Pi inside Herdr.");
      const result =
        params.action === "reconcile"
          ? await herdr.reconcile(reporter(ctx))
          : await startWorktree(params, ctx, toolCallId, deps, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "foreground_terminal",
    label: "Foreground terminal",
    description:
      "Run an interactive terminal command by handing the terminal from Pi to the command, then restoring Pi when it exits. Use for TUI/full-screen programs the user wants to see or control, such as hunk, lazygit, nvim or less. Use bash for ordinary commands whose output should be captured for the model.",
    executionMode: "sequential",
    parameters: Type.Object({
      command: Type.String({
        minLength: 1,
        description: "Shell command to run interactively in the foreground.",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory; defaults to Pi's current working directory.",
        }),
      ),
    }),
    promptSnippet:
      "Hand the terminal to an interactive/full-screen command and restore Pi after it exits.",
    promptGuidelines: [
      "Use foreground_terminal when the user asks to open, show or interact with a terminal UI such as hunk, lazygit, nvim, less or an installer prompt.",
      "Use bash for non-interactive commands whose output should be captured and reasoned about.",
    ],
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui")
        throw new Error(
          "Foreground terminal commands require interactive Pi TUI mode.",
        );
      signal?.throwIfAborted();
      const cwd = resolve(ctx.cwd, params.cwd ?? ".");
      const shell = getShellConfig();
      const result = await ctx.ui.custom<ForegroundResult>(
        (screen, _theme, _keybindings, done) => {
          queueMicrotask(() => {
            terminal
              .run(params.command, { ...shell, cwd, screen, signal })
              .then(done, (error) => {
                done({
                  exitCode: null,
                  signal: null,
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          });
          return { render: () => [], invalidate() {} };
        },
      );
      const suffix = result.error
        ? `failed: ${result.error}`
        : result.signal
          ? `terminated by ${result.signal}`
          : `exited with code ${result.exitCode ?? "unknown"}`;
      return {
        content: [{ type: "text", text: `Foreground command ${suffix}.` }],
        details: { command: params.command, cwd, ...result },
        isError: Boolean(
          result.error || result.signal || result.exitCode !== 0,
        ),
      };
    },
  });
}
