import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import * as metadata from "./git.ts";
import { createHerdr } from "./herdr.ts";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}
function repoAt(path) {
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "file"), "probe\n");
  git(path, "add", "file");
  git(
    path,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Initial",
  );
}
function worktree(root, path, branch) {
  git(root, "worktree", "add", "-qb", branch, path);
}

// Only the Herdr transport is fake. Git metadata and checkout mutations are real.
function sidebar(state) {
  return async (args) => {
    const action = args.slice(0, 2).join(" ");
    if (action === "workspace list") {
      return {
        workspaces: [
          ...Object.keys(state.repos),
          ...Object.values(state.spaces).map((space) => space.id),
        ].map((workspace_id) => ({ workspace_id })),
      };
    }
    if (action === "workspace get") {
      if (state.repos[args[2]])
        return { workspace: { focused: false, pane_count: 1 } };
      const entry = Object.entries(state.spaces).find(
        ([, space]) => space.id === args[2],
      );
      if (!entry) throw new Error("No workspace");
      const [path, space] = entry;
      return {
        workspace: {
          focused: !!space.focused,
          pane_count: space.paneCount ?? 1,
          worktree: {
            checkout_path: path,
            repo_key: state.repos[space.workspace],
            is_linked_worktree: true,
          },
        },
      };
    }
    if (action === "workspace close") {
      const entry = Object.entries(state.spaces).find(
        ([, space]) => space.id === args[2],
      );
      if (!entry) throw new Error("No workspace");
      const [path] = entry;
      delete state.spaces[path];
      state.closeCalls.push({ workspace: args[2], path });
      return {};
    }
    if (action === "agent list") {
      return {
        agents: Object.values(state.spaces)
          .filter((space) => space.agent)
          .map((space) => ({ workspace_id: space.id })),
      };
    }
    if (action === "worktree list") {
      const id = args[args.indexOf("--workspace") + 1];
      const rootId = state.repos[id]
        ? id
        : Object.values(state.spaces).find((space) => space.id === id)
            ?.workspace;
      const root = state.repos[rootId];
      if (!root) throw new Error("No repository");
      const records = git(root, "worktree", "list", "--porcelain", "-z")
        .split("\0\0")
        .filter(Boolean)
        .map((record) => record.split("\0"));
      state.listCalls++;
      return {
        source: {
          repo_key: root,
          source_checkout_path: root,
          source_workspace_id: rootId,
        },
        worktrees: records.map((fields, i) => {
          const path = fields[0].slice("worktree ".length);
          return {
            path,
            is_linked_worktree: i > 0,
            is_bare: false,
            is_prunable: fields.some((field) => field.startsWith("prunable ")),
            branch: fields
              .find((field) => field.startsWith("branch "))
              ?.slice("branch ".length),
            open_workspace_id:
              state.spaces[path]?.id ?? (i === 0 ? rootId : null),
          };
        }),
      };
    }
    if (action === "worktree open") {
      assert.ok(args.includes("--no-focus"));
      const path = args[args.indexOf("--path") + 1];
      const workspace = args[args.indexOf("--workspace") + 1];
      if (!state.repos[workspace] || state.failOpen)
        throw new Error("Cannot open workspace");
      state.spaces[path] = { id: `child-${++state.nextId}`, workspace };
      state.openCalls.push({ workspace, path });
      return { path };
    }
    throw new Error(`Unexpected Herdr operation: ${args.join(" ")}`);
  };
}

test("creates/opens workspaces without focus and uses agent-agnostic start/prompt operations", async () => {
  let occupied = true;
  let panes = [{ pane_id: "child:p1" }];
  const request = vi.fn(async (args) => {
    const action = args.slice(0, 2).join(" ");
    if (action === "worktree list")
      return { source: { source_workspace_id: "parent" } };
    if (action === "worktree create" || action === "worktree open")
      return { workspace: { workspace_id: "child" } };
    if (action === "agent list")
      return {
        agents: occupied
          ? [{ workspace_id: "child", pane_id: "child:p1" }]
          : [],
      };
    if (action === "pane list") return { panes };
    if (action === "agent start" || action === "agent prompt") return {};
    throw new Error(`Unexpected Herdr operation: ${action}`);
  });
  const herdr = createHerdr({ git: metadata, request });
  const options = {
    primary: "/repo",
    path: "/task",
    branch: "task",
    base: "main",
    existing: false,
  };
  expect(await herdr.openWorktree(options)).toBe("child");
  expect(request).toHaveBeenCalledWith(
    [
      "worktree",
      "create",
      "--workspace",
      "parent",
      "--path",
      "/task",
      "--branch",
      "task",
      "--base",
      "main",
      "--no-focus",
    ],
    undefined,
  );
  await herdr.openWorktree({ ...options, existing: true });
  expect(request).toHaveBeenCalledWith(
    [
      "worktree",
      "open",
      "--workspace",
      "parent",
      "--path",
      "/task",
      "--no-focus",
    ],
    undefined,
  );
  expect(await herdr.inspectWorkspace("child")).toEqual({
    pane: "child:p1",
    occupied: true,
  });
  expect(request.mock.calls.some(([args]) => args[0] === "pane")).toBe(false);
  occupied = false;
  expect(await herdr.inspectWorkspace("child")).toEqual({
    pane: "child:p1",
    occupied: false,
  });
  panes = [...panes, { pane_id: "child:p2" }];
  await expect(herdr.inspectWorkspace("child")).rejects.toThrow(
    /single available shell pane/,
  );
  await herdr.startAgent({
    name: "worker",
    kind: "codex",
    pane: "child:p1",
    args: ["--flag"],
  });
  await herdr.promptAgent("worker", "Do the task");
  expect(request).toHaveBeenCalledWith(
    [
      "agent",
      "start",
      "worker",
      "--kind",
      "codex",
      "--pane",
      "child:p1",
      "--",
      "--flag",
    ],
    undefined,
  );
  expect(request).toHaveBeenCalledWith(
    ["agent", "prompt", "worker", "Do the task"],
    undefined,
  );
});

test("reconciles sidebar repositories without reopening parked or closing occupied workspaces", async () => {
  const base = mkdtempSync(join(tmpdir(), "factory-herdr-"));
  vi.stubEnv("HERDR_ENV", "1");
  try {
    const first = join(base, "first");
    const second = join(base, "second");
    const other = join(base, "not-in-sidebar");
    for (const path of [first, second, other]) repoAt(path);
    const old = join(base, "old");
    worktree(second, old, "old");
    const state = {
      repos: { w1: first, w2: second },
      spaces: {},
      openCalls: [],
      closeCalls: [],
      nextId: 0,
      listCalls: 0,
    };
    const warnings = [];
    const ctx = { warn: (message) => warnings.push(message) };
    const herdr = createHerdr({ git: metadata, request: sidebar(state) });
    await herdr.inventory(ctx);
    const baseline = state.listCalls;
    await herdr.changed(ctx);
    assert.equal(state.listCalls, baseline);
    assert.deepEqual(state.openCalls, []); // Parked checkout stays parked.

    const newSecond = join(base, "second-feature");
    worktree(second, newSecond, "new-second");
    await herdr.changed(ctx);
    assert.deepEqual(state.openCalls, [{ workspace: "w2", path: newSecond }]);
    worktree(other, join(base, "other-feature"), "other-feature");
    await herdr.changed(ctx);
    assert.equal(state.openCalls.length, 1); // No sidebar workspace for this repo.

    const native = join(base, "native");
    worktree(first, native, "native");
    state.spaces[native] = { id: "native-child", workspace: "w1" };
    await herdr.changed(ctx);
    assert.equal(state.openCalls.length, 1); // Native Herdr already opened it.

    state.repos.w3 = other;
    await herdr.inventory(ctx);
    const newOther = join(base, "new-other");
    worktree(other, newOther, "new-other");
    await herdr.changed(ctx);
    assert.deepEqual(state.openCalls.at(-1), {
      workspace: "w3",
      path: newOther,
    });
    assert.deepEqual(warnings, []);

    const retry = join(base, "retry");
    worktree(second, retry, "retry");
    state.failOpen = true;
    await herdr.changed(ctx);
    assert.equal(
      state.openCalls.some((call) => call.path === retry),
      false,
    );
    assert.equal(warnings.length, 1);
    delete state.failOpen;
    await herdr.changed(ctx);
    assert.deepEqual(state.openCalls.at(-1), { workspace: "w2", path: retry });

    const removedId = state.spaces[newSecond].id;
    git(second, "worktree", "remove", newSecond);
    await herdr.changed(ctx);
    assert.deepEqual(state.closeCalls, [
      { workspace: removedId, path: newSecond },
    ]);
    assert.equal(state.spaces[newSecond], undefined);
    assert.match(
      git(second, "worktree", "list", "--porcelain"),
      /worktree .*old/,
    );

    state.spaces[old] = { id: "external-child", workspace: "w2" };
    git(second, "worktree", "remove", old);
    await herdr.changed(ctx);
    assert.deepEqual(
      state.closeCalls.at(-1),
      { workspace: "external-child", path: old },
      JSON.stringify(warnings),
    );

    state.spaces[newOther].agent = true;
    git(other, "worktree", "remove", newOther);
    await herdr.changed(ctx);
    assert.equal(state.closeCalls.length, 2);
    assert.match(warnings.at(-1), /running agent/);
    state.spaces[retry].paneCount = 2;
    git(second, "worktree", "remove", retry);
    await herdr.changed(ctx);
    assert.equal(state.closeCalls.length, 2);
    assert.match(warnings.at(-1), /multiple panes/);

    vi.stubEnv("HERDR_ENV", "0");
    const outside = join(base, "outside");
    worktree(second, outside, "outside");
    const count = state.openCalls.length;
    await herdr.changed(ctx);
    assert.equal(state.openCalls.length, count);

    const manualStale = join(base, "manually-removed");
    worktree(first, manualStale, "manually-removed");
    state.spaces[manualStale] = { id: "manual-stale", workspace: "w1" };
    git(first, "worktree", "remove", manualStale);
    vi.stubEnv("HERDR_ENV", "1");
    const reconcile = () => herdr.reconcile(ctx);
    assert.deepEqual(await reconcile(), {
      repos: 3,
      opened: 2,
      closed: 1,
      skipped: 2,
      failed: 0,
    });
    assert.equal(state.openCalls.length, count + 2);
    assert.deepEqual(state.closeCalls.at(-1), {
      workspace: "manual-stale",
      path: manualStale,
    });
    assert.equal(state.spaces[manualStale], undefined);
    assert.ok(state.spaces[newOther]);
    assert.ok(state.spaces[retry]);
    assert.deepEqual(await reconcile(), {
      repos: 3,
      opened: 0,
      closed: 0,
      skipped: 2,
      failed: 0,
    });

    rmSync(outside, { recursive: true, force: true });
    assert.match(git(second, "worktree", "list", "--porcelain"), /prunable /);
    assert.deepEqual(await reconcile(), {
      repos: 3,
      opened: 0,
      closed: 1,
      skipped: 2,
      failed: 0,
    });
    assert.deepEqual(state.closeCalls.at(-1).path, outside);
    vi.stubEnv("HERDR_ENV", "0");
    const listCalls = state.listCalls;
    await assert.rejects(reconcile(), /requires Herdr/);
    assert.equal(state.listCalls, listCalls);
    assert.equal(state.closeCalls.length, 4);
  } finally {
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  }
}, 30_000);
