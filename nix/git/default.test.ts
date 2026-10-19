import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("checks native Git hooks before an opt-in LFS upload without installing hooks", () => {
  const source = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-git-"));
  const repo = join(work, "repo");
  const remote = join(work, "remote with spaces.git");
  mkdirSync(repo);
  try {
    const build = (tool: "git" | "prek", selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${source.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.git ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.${tool}.${selector ? `${selector}.` : ""}package`;
      const result = spawnSync(
        "nix",
        [
          "--extra-experimental-features",
          "nix-command flakes",
          "build",
          "--no-link",
          "--print-out-paths",
          "--impure",
          "--expr",
          expr,
        ],
        { encoding: "utf8", timeout: 150_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const check = join(build("prek", "check"), "bin/check-git-hooks");
    const push = join(build("git", "prePush"), "bin/checked-git-lfs-pre-push");
    const lfs = join(build("git", "lfs"), "bin/git-lfs");
    const prek = join(build("prek", ""), "bin/prek");
    const tools = join(build("prek", "tools"), "bin");
    const env = {
      ...process.env,
      HOME: work,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${tools}:${join(lfs, "..")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    };
    const run = (
      command: string,
      args: string[],
      cwd = repo,
      input?: string,
    ) => {
      const result = spawnSync(command, args, {
        cwd,
        env,
        input,
        encoding: "utf8",
        timeout: 90_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const git = (...args: string[]) => {
      const result = run("git", args);
      expect(result.status, result.output).toBe(0);
      return result.output.trim();
    };

    copyFileSync(
      new URL("../../etc/prek/.pre-commit-config.yaml", import.meta.url),
      join(repo, ".pre-commit-config.yaml"),
    );
    copyFileSync(
      new URL("../../etc/commitizen/.cz.toml", import.meta.url),
      join(repo, ".cz.toml"),
    );
    writeFileSync(
      join(repo, "links.txt"),
      `https://github.com/example/repo/blob/${"a".repeat(40)}/file.go\n`,
    );
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "chore: initial fixture");
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);
    expect(run(check, []).status).toBe(0);
    expect(
      run(prek, [
        "--config",
        ".pre-commit-config.yaml",
        "install",
        "--hook-type",
        "commit-msg",
      ]).status,
    ).toBe(0);
    const invalidMessage = run("git", [
      "commit",
      "--allow-empty",
      "-m",
      "invalid message",
    ]);
    expect(invalidMessage.status).not.toBe(0);
    expect(invalidMessage.output).toContain("commit validation: failed");
    writeFileSync(
      join(repo, "links.txt"),
      "https://github.com/example/repo/blob/main/file.go\n",
    );
    const invalid = run(check, []);
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain("Non-permanent VCS link");
    expect(readFileSync(join(repo, "links.txt"), "utf8")).toContain(
      "blob/main",
    );
    writeFileSync(join(repo, ".git/shallow"), `${git("rev-parse", "HEAD")}\n`);
    expect(run(check, []).output).toContain("requires an unshallow checkout");
    rmSync(join(repo, ".git/shallow"));

    git("init", "--quiet", "--bare", remote);
    git("remote", "add", "origin", remote);
    expect(run(lfs, ["install", "--local", "--skip-repo"]).status).toBe(0);
    expect(run(lfs, ["track", "*.bin"]).status).toBe(0);
    const asset = Buffer.alloc(1200 * 1024 + 1, 0x61);
    writeFileSync(join(repo, "asset.bin"), asset);
    git("add", ".gitattributes", "asset.bin", "links.txt");
    git("commit", "-qm", "feat: add asset");
    const head = git("rev-parse", "HEAD");
    const refs = `refs/heads/main ${head} refs/heads/main ${"0".repeat(40)}\n`;
    const oid = createHash("sha256").update(asset).digest("hex");
    const uploaded = join(
      remote,
      "lfs/objects",
      oid.slice(0, 2),
      oid.slice(2, 4),
      oid,
    );
    const legacy = join(work, "legacy-hook");
    writeFileSync(legacy, `#!/bin/sh\ncat > '${join(work, "legacy-refs")}'\n`);
    chmodSync(legacy, 0o700);
    const rejected = run(push, ["origin", remote], repo, refs);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("Non-permanent VCS link");
    expect(existsSync(join(work, "legacy-refs"))).toBe(false);
    expect(existsSync(uploaded)).toBe(false);

    writeFileSync(
      join(repo, "links.txt"),
      `https://github.com/example/repo/blob/${"a".repeat(40)}/file.go\n`,
    );
    git("add", "links.txt");
    git("commit", "-qm", "fix: restore permalink");
    // Git LFS may install its own upload-first hook when tracking files. The
    // consumer must explicitly wire the checked entry point over that hook.
    const hook = join(repo, ".git/hooks/pre-push");
    writeFileSync(hook, `#!/bin/sh\nexec '${push}' "$@"\n`);
    chmodSync(hook, 0o700);
    const accepted = spawnSync("git", ["push", "origin", "main"], {
      cwd: repo,
      env: { ...env, GIT_PRE_PUSH_LEGACY: legacy },
      encoding: "utf8",
      timeout: 90_000,
    });
    if (accepted.error) throw accepted.error;
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(readFileSync(join(work, "legacy-refs"), "utf8")).toBe(
      `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${"0".repeat(40)}\n`,
    );
    expect(readFileSync(uploaded)).toEqual(asset);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 240_000);

it("generates an opt-in pre-push config without enabling fixes or changing other hooks", () => {
  const source = new URL("../../", import.meta.url);
  const template = readFileSync(
    new URL("../../etc/prek/.pre-commit-config.yaml", import.meta.url),
    "utf8",
  );
  const buildConfig = (ids: string[]) => {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${source.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.prek ]; specialArgs = { inherit pkgs; };
    }).config.quantile.prek.withPrePush [ ${ids.map((id) => JSON.stringify(id)).join(" ")} ]`;
    const result = spawnSync(
      "nix",
      [
        "--extra-experimental-features",
        "nix-command flakes",
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        expr,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (result.error) throw result.error;
    return result;
  };
  const enabled = buildConfig(["keep-sorted", "markdown", "check-json"]);
  expect(enabled.status, enabled.stderr).toBe(0);
  const generated = readFileSync(enabled.stdout.trim(), "utf8");
  expect(generated).toBe(
    template
      .replace(
        "entry: keep-sorted --mode lint\n        language: system\n        stages: [manual]",
        "entry: keep-sorted --mode lint\n        language: system\n        stages: [pre-push]",
      )
      .replace(
        "entry: check-markdown\n        language: system\n        stages: [manual]",
        "entry: check-markdown\n        language: system\n        stages: [pre-push]",
      ),
  );
  expect(generated).toContain("exclude: *keep-sorted-excludes");
  expect(generated).toContain(
    "entry: keep-sorted --mode fix\n        language: system\n        stages: [manual]",
  );
  expect(
    readFileSync(
      new URL("../../etc/prek/.pre-commit-config.yaml", import.meta.url),
      "utf8",
    ),
  ).toBe(template);
  expect(buildConfig(["keep-sorted-fix"]).stderr).toContain(
    "Fix hooks must stay manual",
  );
  expect(buildConfig(["does-not-exist"]).stderr).toContain(
    "Expected one native Prek hook",
  );
}, 180_000);
