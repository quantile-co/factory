import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exports a usable Commitizen CLI and its native configuration independently of Git hooks", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.commitizen ]; specialArgs = { inherit pkgs; };
  }).config.quantile-co.factory.commitizen.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const config = readFileSync(
    new URL("../../etc/commitizen/.cz.toml", import.meta.url),
    "utf8",
  );
  expect(config).toContain("[tool.commitizen]");
  const version = spawnSync(
    `${built.stdout.trim().split("\n")[0]}/bin/cz`,
    ["version"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (version.error) throw version.error;
  expect(version.status, version.stderr).toBe(0);
  expect(version.stdout + version.stderr).toMatch(/\d+\.\d+/);
}, 150_000);

it("checks newly pushed commit messages, not commit-time hooks or old history", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.commitizen ]; specialArgs = { inherit pkgs; };
  }).config.quantile-co.factory.commitizen.prePush.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const checker = join(built.stdout.trim(), "bin/check-commitizen-push");
  const work = mkdtempSync(join(tmpdir(), "factory-commitizen-"));
  const repo = join(work, "repo");
  mkdirSync(repo);
  try {
    copyFileSync(
      new URL("../../etc/commitizen/.cz.toml", import.meta.url),
      join(repo, ".cz.toml"),
    );
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 20_000,
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    git("init", "-q", "--initial-branch=main");
    const commit = (message: string, amend = false) =>
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-q",
        "--allow-empty",
        ...(amend ? ["--amend"] : []),
        "-m",
        message,
      );
    commit("chore: initial");
    const previous = git("rev-parse", "HEAD");
    commit("bad message");
    const refs = join(work, "refs");
    const check = () =>
      spawnSync(checker, [], {
        cwd: repo,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          GIT_PRE_PUSH_REFS: refs,
          HOME: work,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      });
    writeFileSync(
      refs,
      `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${previous}\n`,
    );
    const rejected = check();
    if (rejected.error) throw rejected.error;
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("Invalid commit message");
    commit("fix: valid message", true);
    writeFileSync(
      refs,
      `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${previous}\n`,
    );
    const accepted = check();
    expect(accepted.status, accepted.stderr).toBe(0);
    writeFileSync(
      refs,
      `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${"0".repeat(40)}\n`,
    );
    expect(check().status).toBe(0);
    writeFileSync(
      refs,
      `refs/heads/main ${"0".repeat(40)} refs/heads/main ${previous}\n`,
    );
    expect(check().status).toBe(0);
    expect(git("rev-parse", "HEAD")).toMatch(/^[a-f0-9]{40}$/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
