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
    const permalink = `https://github.com/example/repo/${["blob", "a".repeat(40)].join("/")}/file.go\n`;
    writeFileSync(join(repo, "links.txt"), permalink);
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "chore: initial fixture");
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);
    expect(existsSync(join(repo, ".git/hooks/commit-msg"))).toBe(false);
    expect(run(check, []).status).toBe(0);
    const previous = git("rev-parse", "HEAD");
    const invalidMessage = run("git", [
      "commit",
      "--allow-empty",
      "-m",
      "invalid message",
    ]);
    expect(invalidMessage.status).toBe(0);
    const rejectedMessage = run(
      push,
      ["origin", remote],
      repo,
      `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${previous}\n`,
    );
    expect(rejectedMessage.status).not.toBe(0);
    expect(rejectedMessage.output).toContain("Invalid commit message");
    git(
      "commit",
      "--amend",
      "--allow-empty",
      "-qm",
      "chore: corrected message",
    );
    const nonPermanent = [
      "https://github.com/example/repo",
      "blob/main/file.go",
    ].join("/");
    writeFileSync(join(repo, "links.txt"), `${nonPermanent}\n`);
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

    writeFileSync(join(repo, "links.txt"), permalink);
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

it("installs one shared pre-push hook inherited by new worktrees without replacing another hook", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-git-install-"));
  try {
    const source = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${source.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.git ]; specialArgs = { inherit pkgs; };
    }).config.quantile.git.prePush.install.package`;
    const built = spawnSync(
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
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const install = join(
      built.stdout.trim(),
      "bin/install-checked-git-pre-push",
    );
    const repo = join(work, "repo");
    const branch = join(work, "branch");
    mkdirSync(repo);
    copyFileSync(
      new URL("../../etc/prek/.pre-commit-config.yaml", import.meta.url),
      join(repo, ".pre-commit-config.yaml"),
    );
    copyFileSync(
      new URL("../../etc/commitizen/.cz.toml", import.meta.url),
      join(repo, ".cz.toml"),
    );
    const run = (command: string, args: string[], cwd = repo) => {
      const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: 90_000,
      });
      if (result.error) throw result.error;
      return result;
    };
    expect(run("git", ["init", "-q", "--initial-branch=main"]).status).toBe(0);
    expect(
      run("git", ["add", ".pre-commit-config.yaml", ".cz.toml"]).status,
    ).toBe(0);
    expect(
      run("git", [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-q",
        "-m",
        "chore: initial",
      ]).status,
    ).toBe(0);
    const remote = join(work, "remote.git");
    expect(run("git", ["init", "-q", "--bare", remote]).status).toBe(0);
    expect(run("git", ["remote", "add", "origin", remote]).status).toBe(0);
    const commonDir = run("git", [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).stdout.trim();
    const hook = join(commonDir, "hooks/pre-push");
    const globalConfig = join(work, "global.gitconfig");
    writeFileSync(
      globalConfig,
      `[core]\n\thooksPath = ${join(work, "unrelated-hooks")}\n`,
    );
    const refusedGlobal = spawnSync(install, [], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig },
    });
    if (refusedGlobal.error) throw refusedGlobal.error;
    expect(refusedGlobal.status).not.toBe(0);
    expect(refusedGlobal.stderr).toContain(
      "Refusing to shadow existing global core.hooksPath",
    );
    expect(existsSync(hook)).toBe(false);
    expect(run(install, []).status).toBe(0);
    expect(run(install, []).status).toBe(0);
    expect(existsSync(hook)).toBe(true);
    expect(existsSync(join(commonDir, "hooks/commit-msg"))).toBe(false);
    expect(
      run("git", ["worktree", "add", "-q", "-b", "topic", branch]).status,
    ).toBe(0);
    const gitDir = run(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-dir"],
      branch,
    ).stdout.trim();
    expect(gitDir).not.toBe(commonDir);
    expect(run("git", ["config", "--get", "core.hooksPath"]).status).toBe(1);
    expect(
      run("git", ["config", "--get", "core.hooksPath"], branch).status,
    ).toBe(1);
    expect(
      run(
        "git",
        ["rev-parse", "--git-path", "hooks/pre-push"],
        branch,
      ).stdout.trim(),
    ).toBe(hook);
    expect(existsSync(join(branch, ".pre-commit-config.yaml"))).toBe(true);
    const managed = readFileSync(hook, "utf8");
    expect(managed).toContain("checked-git-lfs-pre-push");
    writeFileSync(
      hook,
      `#!/bin/sh\nexec /nix/store/${"0".repeat(32)}-checked-git-lfs-pre-push/bin/checked-git-lfs-pre-push "$@"\n`,
    );
    expect(run(install, [], branch).status).toBe(0);
    expect(readFileSync(hook, "utf8")).toBe(managed);
    const executed = spawnSync(hook, ["origin", remote], {
      cwd: branch,
      input: "",
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        HOME: work,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    if (executed.error) throw executed.error;
    expect(executed.status, executed.stderr).toBe(0);
    expect(executed.stdout + executed.stderr).toContain(
      "Check large source files",
    );
    const previous = run("git", ["rev-parse", "HEAD"], branch).stdout.trim();
    expect(
      run(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "bad subject",
        ],
        branch,
      ).status,
    ).toBe(0);
    const current = run("git", ["rev-parse", "HEAD"], branch).stdout.trim();
    const blocked = spawnSync(hook, ["origin", remote], {
      cwd: branch,
      input: `refs/heads/topic ${current} refs/heads/topic ${previous}\n`,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        HOME: work,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    if (blocked.error) throw blocked.error;
    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout + blocked.stderr).toContain("Invalid commit message");
    expect(
      run(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-q",
          "--amend",
          "--allow-empty",
          "-m",
          "fix: valid message",
        ],
        branch,
      ).status,
    ).toBe(0);
    const repaired = run("git", ["rev-parse", "HEAD"], branch).stdout.trim();
    const allowed = spawnSync(hook, ["origin", remote], {
      cwd: branch,
      input: `refs/heads/topic ${repaired} refs/heads/topic ${previous}\n`,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        HOME: work,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    if (allowed.error) throw allowed.error;
    expect(allowed.status, allowed.stderr).toBe(0);
    const pushed = run("git", ["push", "origin", "topic"], branch);
    expect(pushed.status, pushed.stderr).toBe(0);
    expect(pushed.stdout + pushed.stderr).toContain(
      "Check pushed Conventional Commits",
    );
    expect(
      run("git", ["rev-parse", "refs/heads/topic"], remote).stdout.trim(),
    ).toBe(repaired);

    // Migrate a hook installed by the previous worktree-local installer.
    const localHookDir = join(gitDir, "hooks");
    mkdirSync(localHookDir, { recursive: true });
    writeFileSync(join(localHookDir, "pre-push"), managed);
    expect(
      run("git", ["config", "--local", "extensions.worktreeConfig", "true"])
        .status,
    ).toBe(0);
    expect(
      run(
        "git",
        ["config", "--worktree", "core.hooksPath", localHookDir],
        branch,
      ).status,
    ).toBe(0);
    expect(run(install, [], branch).status).toBe(0);
    expect(
      run("git", ["config", "--worktree", "--get", "core.hooksPath"], branch)
        .status,
    ).toBe(1);
    expect(readFileSync(hook, "utf8")).toBe(managed);
    expect(readFileSync(join(localHookDir, "pre-push"), "utf8")).toBe(managed);

    const foreign = join(work, "custom-hooks");
    mkdirSync(foreign);
    expect(
      run("git", ["config", "--worktree", "core.hooksPath", foreign], branch)
        .status,
    ).toBe(0);
    const refusedOverride = run(install, [], branch);
    expect(refusedOverride.status).not.toBe(0);
    expect(refusedOverride.stderr).toContain(
      "Refusing to replace existing worktree core.hooksPath",
    );
    expect(
      run(
        "git",
        ["config", "--worktree", "--get", "core.hooksPath"],
        branch,
      ).stdout.trim(),
    ).toBe(foreign);
    expect(
      run("git", ["config", "--worktree", "--unset", "core.hooksPath"], branch)
        .status,
    ).toBe(0);

    writeFileSync(hook, "#!/bin/sh\nexit 0\n");
    const refused = run(install, [], branch);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain(
      "Refusing to replace an existing shared pre-push hook",
    );
    expect(readFileSync(hook, "utf8")).toBe("#!/bin/sh\nexit 0\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);

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
