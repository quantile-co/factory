import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

interface Context {
  warn(message: string): void;
}
interface Dependencies {
  git: {
    metadataDir(checkout: string): Promise<string>;
    metadataStamp(path: string): string;
  };
  request?: typeof request;
}

const execFileAsync = promisify(execFile);

type HerdrWorktree = {
  path: string;
  open_workspace_id?: string | null;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  is_bare: boolean;
  branch?: string | null;
};
type KnownWorktree = { workspaceId?: string; branch?: string | null };
type WorktreeList = {
  source: {
    repo_key: string;
    source_checkout_path: string;
    source_workspace_id: string;
  };
  worktrees: HerdrWorktree[];
};
type Repository = {
  primaryWorkspace: string;
  metadataDir: string;
  stamp: string;
  knownWorktrees: Map<string, KnownWorktree>; // Preserve workspace IDs after Git stops listing a checkout.
};

// biome-ignore lint/suspicious/noExplicitAny: Herdr's JSON response varies by command.
async function request(args: string[], signal?: AbortSignal): Promise<any> {
  const { stdout } = await execFileAsync("herdr", args, {
    signal,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const response = JSON.parse(stdout);
  if (response.error)
    throw new Error(response.error.message ?? "Herdr request failed");
  return response.result;
}

function herdrErrorCode(error: unknown): string | undefined {
  try {
    return JSON.parse((error as { stderr: string }).stderr).error?.code;
  } catch {
    return undefined;
  }
}

export function createHerdr({
  git: { metadataDir, metadataStamp },
  request: herdr = request,
}: Dependencies) {
  const repositories = new Map<string, Repository>();
  let workspaceIds = new Set<string>();
  // Callers may run operations concurrently; serialize sidebar inventory updates.
  let queue: Promise<void> = Promise.resolve();

  function report(ctx: Context, error: unknown): void {
    ctx.warn(
      `Herdr worktree integration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  async function refreshInventory(force = false): Promise<void> {
    const list = await herdr(["workspace", "list"]);
    const current = new Set<string>(
      list.workspaces.map(
        (workspace: { workspace_id: string }) => workspace.workspace_id,
      ),
    );
    if (
      !force &&
      current.size === workspaceIds.size &&
      [...current].every((id) => workspaceIds.has(id))
    )
      return;

    const newIds = force
      ? [...current]
      : [...current].filter((id) => !workspaceIds.has(id));
    workspaceIds = current;
    if (force) repositories.clear();
    for (const [key, repo] of repositories) {
      if (!current.has(repo.primaryWorkspace)) repositories.delete(key);
    }

    for (const id of newIds) {
      let list: WorktreeList;
      try {
        list = (await herdr([
          "worktree",
          "list",
          "--workspace",
          id,
        ])) as WorktreeList;
      } catch {
        // A sidebar workspace can be a terminal, not a Git repository.
        continue;
      }
      const source = list.source;
      if (
        !source.source_workspace_id ||
        !current.has(source.source_workspace_id)
      )
        continue;
      if (repositories.has(source.repo_key)) continue;
      try {
        const dir = await metadataDir(source.source_checkout_path);
        repositories.set(source.repo_key, {
          primaryWorkspace: source.source_workspace_id,
          metadataDir: dir,
          stamp: metadataStamp(dir),
          // Don't unexpectedly reopen previously parked worktrees on Pi startup.
          knownWorktrees: new Map(
            list.worktrees
              .filter((worktree) => worktree.is_linked_worktree)
              .map((worktree) => [
                worktree.path,
                {
                  workspaceId: worktree.open_workspace_id ?? undefined,
                  branch: worktree.branch,
                },
              ]),
          ),
        });
      } catch {
        // If this checkout has disappeared, it is not a usable Herdr workspace.
      }
    }
  }

  async function closeStaleWorkspace(
    ctx: Context,
    workspaceId: string,
    path: string,
    primaryWorkspace: string,
  ): Promise<"closed" | "unsafe" | "absent"> {
    if (workspaceId === primaryWorkspace) return "absent";
    const { workspaces } = await herdr(["workspace", "list"]);
    if (
      !workspaces.some(
        (workspace: { workspace_id: string }) =>
          workspace.workspace_id === workspaceId,
      )
    )
      return "absent";
    const { workspace } = await herdr(["workspace", "get", workspaceId]);
    if (
      workspace.worktree?.checkout_path !== path ||
      !workspace.worktree.is_linked_worktree
    )
      return "absent";
    if (workspace.focused || workspace.pane_count > 1) {
      report(
        ctx,
        `Worktree ${path} is no longer in Git, but its Herdr workspace is focused or has multiple panes; close it manually.`,
      );
      return "unsafe";
    }
    const { agents } = await herdr(["agent", "list"]);
    if (
      agents.some(
        (agent: { workspace_id: string }) => agent.workspace_id === workspaceId,
      )
    ) {
      report(
        ctx,
        `Worktree ${path} is no longer in Git, but its Herdr workspace has a running agent; close it manually.`,
      );
      return "unsafe";
    }
    // Unlike herdr worktree remove, workspace close never deletes a checkout.
    await herdr(["workspace", "close", workspaceId]);
    return "closed";
  }

  async function openNewWorktrees(ctx: Context): Promise<void> {
    for (const repo of repositories.values()) {
      try {
        const stamp = metadataStamp(repo.metadataDir);
        if (stamp === repo.stamp) continue; // No Git worktree add/remove in this repository.

        const list = (await herdr([
          "worktree",
          "list",
          "--workspace",
          repo.primaryWorkspace,
        ])) as WorktreeList;
        const paths = new Set(list.worktrees.map((worktree) => worktree.path));
        for (const worktree of list.worktrees) {
          if (
            repo.knownWorktrees.has(worktree.path) ||
            !worktree.is_linked_worktree ||
            worktree.is_prunable ||
            worktree.is_bare
          )
            continue;
          if (worktree.open_workspace_id) continue; // Herdr's own worktree create/open already did this.
          try {
            await herdr([
              "worktree",
              "open",
              "--workspace",
              repo.primaryWorkspace,
              "--path",
              worktree.path,
              "--no-focus",
            ]);
          } catch (error) {
            // Another Pi pane might have opened the same worktree concurrently.
            const latest = (await herdr([
              "worktree",
              "list",
              "--workspace",
              repo.primaryWorkspace,
            ])) as WorktreeList;
            if (
              !latest.worktrees.some(
                (entry) =>
                  entry.path === worktree.path && entry.open_workspace_id,
              )
            )
              throw error;
          }
        }
        // workspace.close only changes Herdr's sidebar; worktree.remove would run Git again.
        // Never close the main workspace, a workspace still associated with another path,
        // or a pane containing an agent, extra splits, or the user's current focus.
        const addedBranches = new Set(
          list.worktrees
            .filter((worktree) => !repo.knownWorktrees.has(worktree.path))
            .map((worktree) => worktree.branch)
            .filter(Boolean),
        );
        for (const [path, previous] of repo.knownWorktrees) {
          if (paths.has(path)) continue;
          if (previous.branch && addedBranches.has(previous.branch)) continue; // Likely a move, not a removal.
          const current = await herdr(["workspace", "list"]);
          let spaceId = previous.workspaceId;
          // A checkout may have been opened from outside Pi after we indexed it.
          // Only search the sidebar on removal, never on ordinary Bash calls.
          if (!spaceId) {
            for (const item of current.workspaces as {
              workspace_id: string;
            }[]) {
              if (item.workspace_id === repo.primaryWorkspace) continue;
              const details = await herdr([
                "workspace",
                "get",
                item.workspace_id,
              ]);
              if (
                details.workspace.worktree?.checkout_path === path &&
                details.workspace.worktree.is_linked_worktree
              ) {
                spaceId = item.workspace_id;
                break;
              }
            }
          }
          if (
            spaceId &&
            current.workspaces.some(
              (workspace: { workspace_id: string }) =>
                workspace.workspace_id === spaceId,
            )
          ) {
            await closeStaleWorkspace(
              ctx,
              spaceId,
              path,
              repo.primaryWorkspace,
            );
          }
        }
        // Fetch fresh IDs: Herdr may have opened the new checkouts during this call.
        const latest = (await herdr([
          "worktree",
          "list",
          "--workspace",
          repo.primaryWorkspace,
        ])) as WorktreeList;
        repo.knownWorktrees = new Map(
          latest.worktrees
            .filter((worktree) => worktree.is_linked_worktree)
            .map((worktree) => [
              worktree.path,
              {
                workspaceId: worktree.open_workspace_id ?? undefined,
                branch: worktree.branch,
              },
            ]),
        );
        repo.stamp = metadataStamp(repo.metadataDir);
      } catch (error) {
        // One missing or untrusted repository must not prevent opening worktrees in other repos.
        report(ctx, error);
      }
    }
  }

  async function reconcile(ctx: Context): Promise<{
    repos: number;
    opened: number;
    closed: number;
    skipped: number;
    failed: number;
  }> {
    const counts = { repos: 0, opened: 0, closed: 0, skipped: 0, failed: 0 };
    const { workspaces } = await herdr(["workspace", "list"]);
    const ids = new Set<string>(
      workspaces.map(
        (workspace: { workspace_id: string }) => workspace.workspace_id,
      ),
    );
    const linked: Array<{ id: string; repoKey: string; path: string }> = [];
    const sources = new Map<string, WorktreeList>();

    for (const { workspace_id: id } of workspaces as {
      workspace_id: string;
    }[]) {
      try {
        const { workspace } = await herdr(["workspace", "get", id]);
        if (workspace.worktree?.is_linked_worktree) {
          linked.push({
            id,
            repoKey: workspace.worktree.repo_key,
            path: workspace.worktree.checkout_path,
          });
        }
        try {
          const list = (await herdr([
            "worktree",
            "list",
            "--workspace",
            id,
          ])) as WorktreeList;
          if (
            ids.has(list.source.source_workspace_id) &&
            !sources.has(list.source.repo_key)
          ) {
            sources.set(list.source.repo_key, list);
          }
        } catch (error) {
          // A checkout can have vanished while its linked sidebar workspace remains.
          // Its primary workspace supplies the repository's Git worktree list.
          if (
            !workspace.worktree?.is_linked_worktree &&
            herdrErrorCode(error) !== "not_git_worktree"
          ) {
            counts.failed++;
            report(ctx, error);
          }
        }
      } catch (error) {
        counts.failed++;
        report(ctx, error);
      }
    }

    counts.repos = sources.size;
    for (const [key, initial] of sources) {
      const root = initial.source.source_workspace_id;
      try {
        const list = (await herdr([
          "worktree",
          "list",
          "--workspace",
          root,
        ])) as WorktreeList;
        const valid = list.worktrees.filter(
          (worktree) =>
            worktree.is_linked_worktree &&
            !worktree.is_prunable &&
            !worktree.is_bare,
        );
        const validPaths = new Set(valid.map((worktree) => worktree.path));
        for (const worktree of valid) {
          if (worktree.open_workspace_id) continue;
          try {
            await herdr([
              "worktree",
              "open",
              "--workspace",
              root,
              "--path",
              worktree.path,
              "--no-focus",
            ]);
            counts.opened++;
          } catch (error) {
            // Avoid reporting an error if another pane opened it concurrently.
            const latest = (await herdr([
              "worktree",
              "list",
              "--workspace",
              root,
            ])) as WorktreeList;
            if (
              latest.worktrees.some(
                (entry) =>
                  entry.path === worktree.path && entry.open_workspace_id,
              )
            )
              continue;
            counts.failed++;
            report(ctx, error);
          }
        }
        for (const space of linked) {
          if (space.repoKey !== key || validPaths.has(space.path)) continue;
          try {
            const result = await closeStaleWorkspace(
              ctx,
              space.id,
              space.path,
              root,
            );
            if (result === "closed") counts.closed++;
            if (result === "unsafe") counts.skipped++;
          } catch (error) {
            counts.failed++;
            report(ctx, error);
          }
        }
      } catch (error) {
        counts.failed++;
        report(ctx, error);
      }
    }
    try {
      await refreshInventory(true);
    } catch (error) {
      counts.failed++;
      report(ctx, error);
    }
    return counts;
  }

  function enqueue(ctx: Context, action: () => Promise<void>): Promise<void> {
    const next = queue
      .then(action, action)
      .catch((error) => report(ctx, error));
    queue = next;
    return next;
  }

  const available = () => process.env.HERDR_ENV === "1";
  return {
    available,
    async inventory(ctx: Context): Promise<void> {
      if (available()) await enqueue(ctx, refreshInventory);
    },
    async changed(ctx: Context): Promise<void> {
      if (available()) await enqueue(ctx, () => openNewWorktrees(ctx));
    },
    clear(): void {
      workspaceIds.clear();
      repositories.clear();
    },
    async reconcile(ctx: Context) {
      if (!available())
        throw new Error("Reconciliation requires Herdr on this host.");
      let result: Awaited<ReturnType<typeof reconcile>> | undefined;
      await enqueue(ctx, async () => {
        result = await reconcile(ctx);
      });
      if (!result)
        throw new Error(
          "Worktree reconciliation failed; inspect Herdr before retrying.",
        );
      return result;
    },
    async openWorktree(
      options: {
        primary: string;
        path: string;
        branch: string;
        base: string;
        existing: boolean;
      },
      signal?: AbortSignal,
    ): Promise<string> {
      const inventory = await herdr(
        ["worktree", "list", "--cwd", options.primary],
        signal,
      );
      const primaryWorkspace = inventory.source.source_workspace_id;
      if (!primaryWorkspace)
        throw new Error(
          "Open the repository's primary checkout as a Herdr workspace first.",
        );
      const opened = await herdr(
        [
          "worktree",
          options.existing ? "open" : "create",
          "--workspace",
          primaryWorkspace,
          "--path",
          options.path,
          ...(options.existing
            ? []
            : ["--branch", options.branch, "--base", options.base]),
          "--no-focus",
        ],
        signal,
      );
      return opened.workspace.workspace_id;
    },
    async inspectWorkspace(
      workspace: string,
      signal?: AbortSignal,
    ): Promise<{ pane: string; occupied: boolean }> {
      const { agents } = await herdr(["agent", "list"], signal);
      const occupied = agents.find(
        (agent: { workspace_id: string }) => agent.workspace_id === workspace,
      );
      if (occupied) return { pane: occupied.pane_id, occupied: true };
      const { panes } = await herdr(
        ["pane", "list", "--workspace", workspace],
        signal,
      );
      if (panes.length !== 1)
        throw new Error(
          "Existing workspace is not a single available shell pane; no pane was repurposed.",
        );
      return { pane: panes[0].pane_id, occupied: false };
    },
    async startAgent(
      options: { name: string; kind: string; pane: string; args: string[] },
      signal?: AbortSignal,
    ): Promise<void> {
      await herdr(
        [
          "agent",
          "start",
          options.name,
          "--kind",
          options.kind,
          "--pane",
          options.pane,
          "--",
          ...options.args,
        ],
        signal,
      );
    },
    async waitForSession(name: string, signal?: AbortSignal): Promise<void> {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        const { agent } = await herdr(["agent", "get", name], signal);
        if (agent.agent !== "pi" || agent.name !== name)
          throw new Error(
            "The launched Pi agent changed before task submission.",
          );
        if (agent.agent_status === "blocked")
          throw new Error(
            "Pi is blocked during startup; no task prompt was sent.",
          );
        if (agent.agent_status === "working")
          throw new Error("Pi is already working; no task prompt was sent.");
        // Pi advertises terminal readiness before enabling normal submission.
        // Its bundled Herdr integration reports the session from session_start,
        // after the editor's startup-only submission handler has been replaced.
        const session = agent.agent_session;
        if (
          ["idle", "done"].includes(agent.agent_status) &&
          session?.source === "herdr:pi" &&
          session.agent === "pi" &&
          session.kind === "path" &&
          typeof session.value === "string" &&
          session.value.length > 0
        )
          return;
        await delay(100, undefined, { signal });
      }
      throw new Error(
        "Pi did not report its initialized session; no task prompt was sent.",
      );
    },
    async promptAgent(
      name: string,
      prompt: string,
      signal?: AbortSignal,
    ): Promise<void> {
      // Herdr's activity gate distinguishes accepted work from a successful PTY
      // write. Include settled states so a fast response is also acknowledged.
      const { agent } = await herdr(
        [
          "agent",
          "prompt",
          name,
          prompt,
          "--wait",
          "--until",
          "working",
          "--until",
          "done",
          "--until",
          "idle",
          "--until",
          "blocked",
          "--timeout",
          "10000",
        ],
        signal,
      );
      if (!["working", "done", "idle"].includes(agent?.agent_status))
        throw new Error(
          "Task acceptance was not confirmed; inspect the child before retrying.",
        );
    },
  };
}
