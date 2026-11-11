import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { guardCommand, guardFile, primaryDrift, repository } from "./git.ts";

it("blocks literal primary-checkout mutations and direct edits without inspecting arbitrary shell execution", async () => {
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
      `cd '${child}' && git -C '${primary}' checkout task`,
      `cd '${child}' && git branch -m main renamed`,
      `cd '${child}'; (cd '${primary}' && gh pr checkout 12)`,
      `git -C '${primary}' branch -m renamed`,
      "git symbolic-ref --delete HEAD",
      "git fetch --update-head-ok origin other:main",
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
    for (const command of [
      "git status && git diff",
      'for repo in one two; do git -C "$repo" status; done',
      'git -C "$CHECKOUT" diff',
      'git "$SUBCOMMAND"',
      "source .envrc; git status",
      "env -u GIT_DIR git status",
      "bash -c 'git status'",
      "sudo true",
      "printf '%s' 'git switch feature'",
    ])
      await expect(
        guardCommand(command, primary),
        command,
      ).resolves.toBeUndefined();
    await expect(guardCommand("git pull --ff-only", primary)).rejects.toThrow(
      /configured remote main/,
    );
    git(primary, "config", "alias.jump", "switch");
    await expect(guardCommand("git jump task", primary)).rejects.toThrow(
      /primary checkout/,
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

it("opts in only the exact disposable orb repository and still protects Git metadata", async () => {
  const base = mkdtempSync(join(tmpdir(), "factory-orb-guard-"));
  const orb = join(base, "orb");
  const other = join(base, "other");
  try {
    for (const path of [orb, other]) {
      mkdirSync(path);
      execFileSync("git", ["init", "-q", "-b", "task", path]);
    }
    vi.stubEnv("FACTORY_AMP_REPOSITORY", orb);
    await expect(guardFile(join(orb, "file"))).rejects.toThrow("not main");
    vi.stubEnv("AMP_ORB", "1");
    const repo = await repository(orb);
    if (!repo) throw new Error("Missing fixture repository");
    expect(primaryDrift(repo)).toBeUndefined();
    await expect(guardFile(join(orb, "file"))).resolves.toBeUndefined();
    await expect(
      guardCommand("git switch feature", orb),
    ).resolves.toBeUndefined();
    await expect(guardFile(join(orb, ".git", "HEAD"))).rejects.toThrow(
      "blocked",
    );
    await expect(guardFile(join(other, "file"))).rejects.toThrow("not main");
    await expect(
      guardCommand(`git -C '${other}' switch feature`, orb),
    ).rejects.toThrow();
    vi.stubEnv("FACTORY_AMP_REPOSITORY", base);
    await expect(guardFile(join(orb, "file"))).rejects.toThrow("not main");
  } finally {
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  }
});

it("allows configured remote-main fast-forwards without admitting other primary mutations", async () => {
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
