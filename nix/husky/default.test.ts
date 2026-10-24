import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { check: 0, lfs: 0, status: 0, order: "check\nlfs\n" },
  { check: 17, lfs: 0, status: 17, order: "check\n" },
  { check: 0, lfs: 23, status: 23, order: "check\nlfs\n" },
])("gates LFS and preserves push refs: $check / $lfs", (test) => {
  const root = mkdtempSync(join(tmpdir(), "factory-husky-"));
  try {
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "tmp"));
    writeFileSync(
      join(root, "bin/direnv"),
      `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == exec && "$2" == . ]]
shift 2
if [[ "$1" == pnpm ]]; then
  [[ "$*" == 'pnpm run check' ]]
  printf 'check\\n' >> "$LOG/order"
  cat > "$LOG/check.refs"
  exit "$CHECK_STATUS"
fi
[[ "$1 $2 $3" == 'git lfs pre-push' ]]
shift 3
printf 'lfs\\n' >> "$LOG/order"
printf '%s\\n' "$@" > "$LOG/lfs.args"
cat > "$LOG/lfs.refs"
exit "$LFS_STATUS"
`,
      { mode: 0o755 },
    );
    const refs = "refs/heads/main abc refs/heads/main def\n";
    const args = ["origin", "remote with spaces"];
    const run = spawnSync(
      "bash",
      [
        fileURLToPath(new URL("../../etc/husky/pre-push", import.meta.url)),
        ...args,
      ],
      {
        cwd: root,
        input: refs,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          TMPDIR: join(root, "tmp"),
          LOG: root,
          CHECK_STATUS: String(test.check),
          LFS_STATUS: String(test.lfs),
        },
      },
    );
    if (run.error) throw run.error;
    expect(run.status, run.stderr).toBe(test.status);
    expect(readFileSync(join(root, "order"), "utf8")).toBe(test.order);
    expect(readFileSync(join(root, "check.refs"), "utf8")).toBe("");
    if (test.order.includes("lfs\n")) {
      expect(readFileSync(join(root, "lfs.refs"), "utf8")).toBe(refs);
      expect(readFileSync(join(root, "lfs.args"), "utf8")).toBe(
        `${args.join("\n")}\n`,
      );
    } else {
      expect(existsSync(join(root, "lfs.refs"))).toBe(false);
    }
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("isolates check subprocesses from Git's real worktree hook environment, preserving LFS", () => {
  const base = mkdtempSync(join(tmpdir(), "factory-hook-env-"));
  const primary = join(base, "primary");
  const child = join(base, "task");
  const remote = join(base, "remote.git");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(primary);
    mkdirSync(join(base, "bin"));
    git(primary, "init", "-q", "-b", "main");
    writeFileSync(join(primary, "file"), "fixture\n");
    git(primary, "add", "file");
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
    git(base, "init", "--bare", "-q", "-b", "main", remote);
    git(primary, "remote", "add", "origin", remote);
    git(primary, "push", "origin", "main");
    git(primary, "worktree", "add", "-qb", "task", child);
    mkdirSync(join(child, "tf"));
    const hook = fileURLToPath(
      new URL("../../etc/husky/pre-push", import.meta.url),
    );
    writeFileSync(join(primary, ".git/hooks/pre-push"), readFileSync(hook), {
      mode: 0o755,
    });
    writeFileSync(
      join(base, "bin/direnv"),
      `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == exec && "$2" == . ]]
shift 2
if [[ "$1" == pnpm ]]; then
  [[ "$*" == 'pnpm run check' ]]
  actual=$(git -C "$ROOT/tf" rev-parse --show-toplevel)
  [[ "$actual" == "$ROOT" ]] || { printf 'Expected check root %s; got %s\\n' "$ROOT" "$actual" >&2; exit 1; }
  git clone --quiet "$REMOTE" "$LOG/module"
  [[ "$(git -C "$LOG/module" rev-parse --show-toplevel)" == "$LOG/module" ]]
  printf 'check\\n' >> "$LOG/order"
  exit 0
fi
[[ "$1 $2 $3" == 'git lfs pre-push' ]]
printf '%s' "\${GIT_DIR:-missing}" > "$LOG/lfs.gitdir"
printf 'lfs\\n' >> "$LOG/order"
cat > "$LOG/lfs.refs"
`,
      { mode: 0o755 },
    );
    const result = spawnSync("git", ["-C", child, "push", "origin", "task"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(base, "bin")}:${process.env.PATH}`,
        ROOT: child,
        LOG: base,
        REMOTE: remote,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(base, "order"), "utf8")).toBe("check\nlfs\n");
    const metadata = git(child, "rev-parse", "--absolute-git-dir");
    expect(readFileSync(join(base, "lfs.gitdir"), "utf8")).toBe(metadata);
    expect(readFileSync(join(base, "lfs.refs"), "utf8")).toBe(
      `refs/heads/task ${git(child, "rev-parse", "HEAD")} refs/heads/task ${"0".repeat(40)}\n`,
    );
    expect(git(remote, "rev-parse", "refs/heads/task")).toBe(
      git(child, "rev-parse", "HEAD"),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
