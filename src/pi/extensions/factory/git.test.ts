import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    ).resolves.toEqual([]);
    await expect(
      guardCommand(
        `(cd '${primary}' && git status); git switch another`,
        child,
      ),
    ).resolves.toEqual([]);
    await expect(
      guardCommand("git status && git diff", primary),
    ).resolves.toEqual([]);
    await expect(
      guardCommand("git pull --ff-only", primary),
    ).resolves.toHaveLength(1);
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
