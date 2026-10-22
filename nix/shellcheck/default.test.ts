import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("lints native-configured shell source and task bodies without executing or editing them", () => {
  const root = new URL("../../", import.meta.url);
  const repo = mkdtempSync(join(tmpdir(), "factory-shellcheck-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.shellcheck ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.shellcheck;
    in [ cfg.check.package cfg.taskCheck.package ]`;
    const build = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (build.error) throw build.error;
    expect(build.status, build.stderr).toBe(0);
    const paths = build.stdout.trim().split("\n");
    const check = join(
      paths.find((path) => path.endsWith("-check-shellcheck")) ?? "",
      "bin/check-shellcheck",
    );
    const task = join(
      paths.find((path) => path.endsWith("-check-shellcheck-task")) ?? "",
      "bin/check-shellcheck-task",
    );
    const run = (
      bin: string,
      args: string[] = [],
      input?: string,
      env: NodeJS.ProcessEnv = {},
    ) => {
      const result = spawnSync(bin, args, {
        cwd: repo,
        input,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(run("git", ["init", "-q"]).status).toBe(0);
    copyFileSync(
      new URL("../../etc/shellcheck/.shellcheckrc", import.meta.url),
      join(repo, ".shellcheckrc"),
    );
    const source = join(repo, "bad path.sh");
    const bad =
      "# shellcheck shell=bash\nvalue='two words'\nprintf '%s\\n' $value\n";
    writeFileSync(source, bad);
    writeFileSync(
      join(repo, ".envrc"),
      "#!/usr/bin/env bash\nprintf '%s\\n' $UNQUOTED\n",
    );
    expect(run("git", ["add", "bad path.sh", ".envrc"]).status).toBe(0);
    const rejected = run(check);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("SC2086");
    expect(readFileSync(source, "utf8")).toBe(bad);
    writeFileSync(join(repo, "alternate.rc"), "disable=SC2086\n");
    const overridden = run(check, [], undefined, {
      SHELLCHECK_CONFIG_FILE: "alternate.rc",
    });
    expect(overridden.status, overridden.output).toBe(0);
    writeFileSync(source, "# shellcheck shell=bash\nprintf '%s\\n' \"$1\"\n");
    expect(run(check).status).toBe(0);
    writeFileSync(
      join(repo, "runner"),
      "#!/usr/bin/env bash\nprintf '%s\\n' $UNQUOTED\n",
    );
    expect(run("git", ["add", "runner"]).status).toBe(0);
    const extensionless = run(check);
    expect(extensionless.status).not.toBe(0);
    expect(extensionless.output).toContain("runner");

    const sentinel = join(repo, "task-ran");
    const body = `printf '%s\\n' $FIXTURE_LABEL > '${sentinel}'\n`;
    const brokenTask = run(task, ["fixture:bad", "FIXTURE_LABEL"], body, {
      FIXTURE_LABEL: "value-not-for-static-lint",
    });
    expect(brokenTask.status).not.toBe(0);
    expect(brokenTask.output).toContain("SC2086");
    expect(brokenTask.output).toContain("fixture:bad");
    expect(
      run(
        task,
        ["fixture:good", "FIXTURE_LABEL"],
        "printf '%s\\n' \"$FIXTURE_LABEL\"\n",
      ).status,
    ).toBe(0);
    expect(existsSync(sentinel)).toBe(false);
    expect(brokenTask.output).not.toContain("value-not-for-static-lint");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}, 180_000);
