import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { guardCommand, guardFile } from "./git.ts";

it("guards actual checkout targets, shell structure, aliases and direct edits without a host integration", async () => {
  const base = mkdtempSync(join(tmpdir(), "factory-git-"));
  const primary = join(base, "primary checkout");
  const child = join(base, "child checkout");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
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
    for (const command of [
      "git switch feature",
      "git checkout -b feature",
      "gh pr checkout 12",
      "gh --repo=owner/repo pr checkout 12",
      "bash -c 'git switch feature'",
      `cd '${child}' && git -C '${primary}' checkout task`,
      `direnv exec '${primary}' git switch feature`,
      `nix develop --command git -C '${primary}' switch feature`,
      `cd '${child}' && git branch -m main renamed`,
      `cd '${child}'; (cd '${primary}' && gh pr checkout 12)`,
      `git -C '${primary}' branch -m renamed`,
      "git symbolic-ref --delete HEAD",
      "git fetch --update-head-ok origin other:main",
      'git -C "$UNKNOWN_CHECKOUT" switch other',
    ])
      await expect(guardCommand(command, primary), command).rejects.toThrow();
    await expect(
      guardCommand(`cd '${child}' && git checkout -b another`, primary),
    ).resolves.toBeUndefined();
    await expect(
      guardCommand(
        `(cd '${primary}' && git status); git switch another`,
        child,
      ),
    ).resolves.toBeUndefined();
    await expect(
      guardCommand("git status && git diff", primary),
    ).resolves.toBeUndefined();
    await expect(guardCommand("git pull --ff-only", primary)).rejects.toThrow(
      /configured remote main/,
    );
    git(primary, "config", "alias.jump", "switch");
    await expect(guardCommand("git jump task", primary)).rejects.toThrow(
      /alias/,
    );
    await expect(guardFile(join(primary, "file.txt"))).rejects.toThrow(
      /primary/,
    );
    await expect(guardFile(join(child, "file.txt"))).resolves.toBeUndefined();
    expect(git(primary, "branch", "--show-current")).toBe("main");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

it("allows only configured remote-main fast-forwards and leaves Git's data protections intact", async () => {
  const base = mkdtempSync(join(tmpdir(), "factory-sync-"));
  const primary = join(base, "primary");
  const child = join(base, "task");
  const remote = join(base, "remote.git");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (cwd: string) => {
    git(cwd, "add", ".");
    git(
      cwd,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "change",
    );
  };
  try {
    mkdirSync(primary);
    git(primary, "init", "-q", "-b", "main");
    git(base, "init", "--bare", "-q", "-b", "main", remote);
    writeFileSync(join(primary, "file"), "initial\n");
    commit(primary);
    git(primary, "remote", "add", "upstream", remote);
    git(primary, "push", "-u", "upstream", "main");
    git(primary, "worktree", "add", "-qb", "task", child);
    for (const command of [
      "git pull --ff-only",
      "git pull --ff-only upstream",
      "git pull --ff-only upstream main",
      "git pull --ff-only upstream refs/heads/main",
      "git merge --ff-only",
      "git merge --ff-only upstream/main",
      "git merge --ff-only refs/remotes/upstream/main",
      "git merge --ff-only '@{u}'",
      "git merge --ff-only '@{upstream}'",
      "bash -c 'git merge --ff-only upstream/main'",
    ])
      await expect(
        guardCommand(command, primary),
        command,
      ).resolves.toBeUndefined();
    for (const command of [
      "git merge upstream/main",
      "git pull",
      "git merge --ff-only task",
      "git merge --ff-only HEAD",
      "git merge --ff-only upstream/main task",
      "git pull --ff-only other main",
      "git pull --ff-only upstream task",
      "git pull --ff-only upstream main task",
      "git pull --ff-only upstream +main:main",
      "git pull --ff-only --rebase",
      "git merge --ff-only --squash upstream/main",
      'git merge --ff-only "$TARGET"',
      "git reset --hard upstream/main",
      "git switch task",
      "git push --force",
    ])
      await expect(guardCommand(command, primary), command).rejects.toThrow();

    git(primary, "tag", "upstream/main");
    await expect(
      guardCommand("git merge --ff-only upstream/main", primary),
    ).rejects.toThrow(/ambiguous/);
    await expect(
      guardCommand("git merge --ff-only refs/remotes/upstream/main", primary),
    ).resolves.toBeUndefined();
    git(primary, "tag", "-d", "upstream/main");
    writeFileSync(join(child, "file"), "remote change\n");
    commit(child);
    git(child, "push", "upstream", "task:main");
    git(primary, "fetch", "upstream");
    writeFileSync(join(primary, "file"), "local uncommitted\n");
    const initial = git(primary, "rev-parse", "HEAD");
    await guardCommand("git merge --ff-only upstream/main", primary);
    expect(() => git(primary, "merge", "--ff-only", "upstream/main")).toThrow();
    expect(git(primary, "rev-parse", "HEAD")).toBe(initial);
    expect(readFileSync(join(primary, "file"), "utf8")).toBe(
      "local uncommitted\n",
    );
    git(primary, "restore", "--", "file");
    writeFileSync(join(primary, "untracked"), "keep me\n");
    git(primary, "merge", "--ff-only", "upstream/main");
    expect(git(primary, "rev-parse", "HEAD")).toBe(
      git(child, "rev-parse", "HEAD"),
    );
    expect(readFileSync(join(primary, "untracked"), "utf8")).toBe("keep me\n");

    writeFileSync(join(primary, "local"), "local commit\n");
    commit(primary);
    writeFileSync(join(child, "file"), "another remote change\n");
    commit(child);
    git(child, "push", "upstream", "task:main");
    git(primary, "fetch", "upstream");
    const divergent = git(primary, "rev-parse", "HEAD");
    await guardCommand("git pull --ff-only upstream main", primary);
    expect(() =>
      git(primary, "pull", "--ff-only", "upstream", "main"),
    ).toThrow();
    expect(git(primary, "rev-parse", "HEAD")).toBe(divergent);
    git(primary, "config", "branch.main.merge", "refs/heads/task");
    await expect(guardCommand("git pull --ff-only", primary)).rejects.toThrow(
      /configured remote main/,
    );
    git(primary, "switch", "-c", "unexpected");
    await expect(
      guardCommand("git merge --ff-only upstream/main", primary),
    ).rejects.toThrow(/not main/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
