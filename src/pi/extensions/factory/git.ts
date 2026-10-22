import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function run(
  command: string,
  args: string[],
  cwd?: string,
  input?: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((accept, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        signal,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(`${command}: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
        else accept(stdout);
      },
    );
    child.stdin?.end(input);
  });
}

const git = (cwd: string, ...args: string[]) =>
  run("git", ["-C", cwd, ...args]);

export type Checkout = { path: string; branch?: string; prunable: boolean };
export type Repository = {
  primary: string;
  common: string;
  checkouts: Checkout[];
};

function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(canonical(parent), basename(path));
}

export async function repository(
  path: string,
): Promise<Repository | undefined> {
  let cwd = canonical(resolve(path));
  while (!existsSync(cwd)) cwd = dirname(cwd);
  // File tool paths may name an existing file rather than a directory.
  if (!statSync(cwd).isDirectory()) cwd = dirname(cwd);
  let common: string;
  try {
    common = canonical(
      (
        await git(
          cwd,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        )
      ).trim(),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not a git repository")
    )
      return undefined;
    throw error;
  }
  const records = (await git(cwd, "worktree", "list", "--porcelain", "-z"))
    .split("\0\0")
    .filter(Boolean);
  if (records[0]?.split("\0").includes("bare"))
    throw new Error("Bare repositories have no primary checkout to protect.");
  const checkouts = records.map((record) => {
    const fields = record.split("\0");
    return {
      path: canonical(fields[0].slice("worktree ".length)),
      branch: fields
        .find((field) => field.startsWith("branch "))
        ?.slice("branch refs/heads/".length),
      prunable: fields.some((field) => field.startsWith("prunable")),
    };
  });
  if (!checkouts[0])
    throw new Error("Git did not identify a primary checkout.");
  return { primary: checkouts[0].path, common, checkouts };
}

export function primaryDrift(repo: Repository): string | undefined {
  const branch = repo.checkouts[0].branch;
  return branch === "main"
    ? undefined
    : `Primary checkout ${repo.primary} is on ${branch ?? "detached HEAD"}, not main. Stop and inspect; no automatic branch repair is performed.`;
}

function localPath(value: string, primary: string): string {
  const expanded =
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value;
  return canonical(
    isAbsolute(expanded) ? expanded : resolve(primary, expanded),
  );
}

export async function destination(
  repo: Repository,
  branch: string,
): Promise<string> {
  let configured = process.env.PI_HERDR_WORKTREE_ROOT;
  if (!configured) {
    // --default makes an unset key a successful read, not an ignored Git failure.
    configured = (
      await git(
        repo.primary,
        "config",
        "--local",
        "--default",
        "",
        "--get",
        "pi.herdrWorktreeRoot",
      )
    ).trim();
  }
  const root = configured
    ? localPath(configured, repo.primary)
    : join(dirname(repo.primary), ".worktrees");
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex").slice(0, 10);
  const slug = branch.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 70);
  return join(
    root,
    `${basename(repo.primary)}-${digest(repo.common)}`,
    `${slug}-${digest(branch)}`,
  );
}

export async function validateBranch(
  repo: Repository,
  branch: string,
  base: string,
): Promise<void> {
  if (
    (await git(repo.primary, "check-ref-format", "--branch", branch)).trim() !==
    branch
  )
    throw new Error("Use a literal branch name.");
  await git(
    repo.primary,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  );
}

export async function metadataDir(checkout: string): Promise<string> {
  return resolve(
    checkout,
    (await git(checkout, "rev-parse", "--git-common-dir")).trim(),
    "worktrees",
  );
}

export function metadataStamp(path: string): string {
  try {
    const s = statSync(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.mtimeNs}:${s.ctimeNs}:${s.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

// shfmt's Bash AST supplies quoting and shell structure; this is deliberately
// a conservative target resolver, not a shell interpreter or a sandbox.
type Node = {
  Type?: string;
  Value?: string;
  Dollar?: boolean;
  Op?: string;
  Parts?: Node[];
  Args?: Node[];
  Stmts?: Node[];
  Cmd?: Node;
  X?: Node;
  Y?: Node;
  Background?: boolean;
  Assigns?: Node[];
  [key: string]: unknown;
};
function word(node: Node): string | undefined {
  if (node.Type === "Lit" || (node.Type === "SglQuoted" && !node.Dollar)) {
    return node.Value?.includes("\\") ? undefined : node.Value;
  }
  if (!node.Parts) return undefined;
  const parts = node.Parts.map(word);
  return parts.every((part) => part !== undefined) ? parts.join("") : undefined;
}
const readOnlyGit = new Set([
  "status",
  "diff",
  "show",
  "log",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "show-ref",
  "symbolic-ref",
  "describe",
  "cat-file",
  "check-ref-format",
  "blame",
  "grep",
  "help",
  "version",
]);
const guidance =
  "Use a linked task checkout; the primary checkout stays on main.";

export async function guardFile(path: string): Promise<void> {
  const repo = await repository(path);
  if (!repo) return;
  const drift = primaryDrift(repo);
  if (drift) throw new Error(drift);
  const target = canonical(resolve(path));
  const owner = repo.checkouts
    .filter(
      (checkout) =>
        target === checkout.path || target.startsWith(`${checkout.path}/`),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (
    owner?.path === repo.primary ||
    target === repo.common ||
    target.startsWith(`${repo.common}/`)
  ) {
    throw new Error(
      `Direct edits to primary checkout ${repo.primary} are blocked. ${guidance}`,
    );
  }
}

export async function guardCommand(
  command: string,
  initialCwd: string,
): Promise<string[]> {
  const tree = JSON.parse(
    await run("shfmt", ["-ln", "bash", "-tojson"], initialCwd, command),
  ) as Node;
  const maintenance = new Set<string>();

  async function inspect(
    args: (string | undefined)[],
    cwd: string | undefined,
    assigned: boolean,
  ): Promise<void> {
    let executable = args.shift();
    if (!executable)
      throw new Error("Cannot safely resolve a dynamic shell executable.");
    executable = basename(executable);
    if (["command", "builtin", "exec", "nohup"].includes(executable)) {
      if (args[0] === "--") args.shift();
      return inspect(args, cwd, assigned);
    }
    if (executable === "direnv" && args[0] === "exec") {
      const dir = args[1];
      if (!dir || (!cwd && !isAbsolute(dir)))
        throw new Error("Cannot resolve direnv exec directory.");
      return inspect(args.slice(2), resolve(cwd ?? "/", dir), assigned);
    }
    if (executable === "nix" && ["develop", "shell"].includes(args[0] ?? "")) {
      const start = args.findIndex(
        (arg) => arg === "--command" || arg === "-c",
      );
      if (start >= 0) return inspect(args.slice(start + 1), cwd, assigned);
      return;
    }
    if (executable === "sudo")
      throw new Error(
        "The checkout guard cannot resolve a sudo execution environment.",
      );
    if (executable === "env") {
      if (!args.length) return;
      while (args[0]?.includes("=") && !args[0]?.startsWith("-")) {
        if (args.shift()?.startsWith("GIT_")) assigned = true;
      }
      if (args[0] === "--") args.shift();
      if (args[0]?.startsWith("-"))
        throw new Error(
          "Use an explicit cwd instead of env options for guarded shell commands.",
        );
      return inspect(args, cwd, assigned);
    }
    if (["bash", "sh", "zsh"].includes(executable)) {
      const flag = args.findIndex(
        (arg) => arg?.startsWith("-") && arg.includes("c"),
      );
      if (flag >= 0) {
        const script = args[flag + 1];
        if (!script || !cwd)
          throw new Error("Cannot resolve nested shell command/cwd.");
        for (const message of await guardCommand(script, cwd))
          maintenance.add(message);
      }
      return;
    }
    if (executable !== "git" && executable !== "gh") return;
    if (assigned)
      throw new Error(
        "Git environment overrides cannot be safely resolved by the checkout guard.",
      );
    if (executable === "git") {
      while (args[0]?.startsWith("-")) {
        const option = args.shift();
        if (option === "-C") {
          const dir = args.shift();
          if (!dir || (!cwd && !isAbsolute(dir)))
            throw new Error("Cannot resolve git -C target.");
          cwd = resolve(cwd ?? "/", dir);
        } else if (
          option === "--no-pager" ||
          option === "--no-optional-locks"
        ) {
          // These options do not change the checkout or command semantics.
        } else {
          throw new Error(
            `Unsupported Git global option ${option}; use a plain git command with -C.`,
          );
        }
      }
    } else {
      while (
        args[0] === "-R" ||
        args[0] === "--repo" ||
        args[0]?.startsWith("--repo=")
      ) {
        args.splice(0, args[0]?.startsWith("--repo=") ? 1 : 2);
      }
      if (args[0] !== "pr" || args[1] !== "checkout") {
        if (args.includes("checkout"))
          throw new Error(
            "Cannot resolve gh checkout options; use plain gh pr checkout in a task checkout.",
          );
        return;
      }
    }
    if (!cwd)
      throw new Error(
        "Cannot resolve checkout after shell control flow; use an absolute git -C path.",
      );
    const repo = await repository(cwd);
    if (!repo) throw new Error(`Cannot identify the Git checkout at ${cwd}.`);
    const checkout = canonical(
      (await git(cwd, "rev-parse", "--show-toplevel")).trim(),
    );
    const subcommand = args[0];
    // Unknown aliases can hide a checkout change, even when invoked from a child.
    if (executable === "git" && subcommand && !readOnlyGit.has(subcommand)) {
      const alias = (
        await git(
          cwd,
          "config",
          "--default",
          "",
          "--get",
          `alias.${subcommand}`,
        )
      ).trim();
      if (alias)
        throw new Error(
          `Git alias ${subcommand} is not inspected; use its explicit command.`,
        );
    }
    const staticArgs = args.filter((arg): arg is string => arg !== undefined);
    // Branch refs are shared: renaming main from a linked checkout also changes
    // the primary checkout's HEAD, without git -C pointing at that checkout.
    if (
      executable === "git" &&
      subcommand === "branch" &&
      (args.includes("main") || args.includes(undefined)) &&
      staticArgs.some(
        (arg) =>
          /^-[^-]*[mMcCdDf]/.test(arg) ||
          /^--(move|copy|delete|force)$/.test(arg),
      )
    ) {
      throw new Error(`Shared main branch mutations are blocked. ${guidance}`);
    }
    if (checkout !== repo.primary) return;
    const readOnly =
      executable === "git" &&
      ((subcommand !== undefined &&
        readOnlyGit.has(subcommand) &&
        subcommand !== "symbolic-ref") ||
        (subcommand === "symbolic-ref" &&
          args.every((arg) => arg !== undefined) &&
          staticArgs
            .slice(1)
            .every((arg) =>
              ["HEAD", "-q", "--quiet", "--short"].includes(arg),
            )) ||
        (subcommand === "branch" &&
          (args.length === 1 ||
            staticArgs
              .slice(1)
              .every((arg) =>
                [
                  "--list",
                  "-l",
                  "-a",
                  "-r",
                  "-v",
                  "-vv",
                  "--show-current",
                ].includes(arg),
              ))) ||
        (subcommand === "worktree" && args[1] === "list") ||
        (subcommand === "config" &&
          staticArgs.some((arg) =>
            [
              "--get",
              "--get-all",
              "--get-regexp",
              "--list",
              "get",
              "list",
            ].includes(arg),
          )));
    if (readOnly) return;
    const drift = primaryDrift(repo);
    if (drift) throw new Error(drift);
    if (
      executable === "git" &&
      subcommand === "fetch" &&
      args.every((arg) => arg !== undefined) &&
      !staticArgs.some(
        (arg) => arg === "-u" || arg.startsWith("--update-head-ok"),
      )
    )
      return;
    if (
      executable === "git" &&
      ["merge", "pull"].includes(subcommand ?? "") &&
      args.includes("--ff-only") &&
      args.every((arg) => arg !== undefined) &&
      staticArgs.every(
        (arg) =>
          !arg.startsWith("-") ||
          [
            "--ff-only",
            "--no-edit",
            "--quiet",
            "-q",
            "--verbose",
            "-v",
          ].includes(arg),
      )
    ) {
      maintenance.add(
        `Allow fast-forward maintenance on main at ${repo.primary}?\n${command}`,
      );
      return;
    }
    throw new Error(
      `Git mutation in primary checkout ${repo.primary} is blocked. ${guidance}`,
    );
  }

  async function walk(
    node: Node,
    cwd: string | undefined,
  ): Promise<string | undefined> {
    if (node.Cmd) {
      const next = await walk(node.Cmd, cwd);
      for (const [key, value] of Object.entries(node))
        if (key !== "Cmd") await children(value, cwd);
      return node.Background ? cwd : next;
    }
    if (
      node.Type === "File" ||
      node.Type === "Block" ||
      node.Type === "Subshell"
    ) {
      let next = cwd;
      for (const stmt of node.Stmts ?? []) next = await walk(stmt, next);
      return node.Type === "Subshell" ? cwd : next;
    }
    if (node.Type === "BinaryCmd" && node.X && node.Y) {
      const left = await walk(node.X, cwd);
      const right = await walk(node.Y, node.Op === "&&" ? left : cwd);
      return node.Op === "&&" ? right : node.Op === "||" ? undefined : cwd;
    }
    if (node.Type === "CallExpr") {
      for (const value of Object.values(node)) await children(value, cwd);
      const args = (node.Args ?? []).map(word);
      if (!args.length) return cwd;
      if (args[0] === "cd") {
        const dir = args[1] === "--" ? args[2] : args[1];
        return dir && !dir.startsWith("-") && (cwd || isAbsolute(dir))
          ? canonical(resolve(cwd ?? "/", dir))
          : undefined;
      }
      if (["pushd", "popd", "eval", "source", "."].includes(args[0] ?? "")) {
        throw new Error(
          "Use explicit commands and cd/absolute git -C paths for guarded shell operations.",
        );
      }
      await inspect(
        args,
        cwd,
        (node.Assigns ?? []).some((assign) =>
          JSON.stringify(assign).includes("GIT_"),
        ),
      );
      return cwd;
    }
    // Branches, loops and functions are inspected without guessing their cwd.
    for (const value of Object.values(node)) await children(value, undefined);
    return undefined;
  }
  async function children(
    value: unknown,
    cwd: string | undefined,
  ): Promise<void> {
    if (Array.isArray(value)) {
      for (const child of value) await children(child, cwd);
    } else if (value && typeof value === "object") {
      const node = value as Node;
      if (node.Type === "CallExpr" || node.Cmd || node.Stmts)
        await walk(node, cwd);
      else for (const child of Object.values(node)) await children(child, cwd);
    }
  }
  await walk(tree, initialCwd);
  return [...maintenance];
}
