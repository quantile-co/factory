import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("uses the managed SonarQube config and submits only configured default-branch checks", () => {
  const root = new URL("../../", import.meta.url);
  const expression = `let
    f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = (pkgs.lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [ f.nixModules.sonarqube {
        quantile-co.factory.sonarqube.package = pkgs.writeShellScriptBin "sonar-scanner" ''
          test -f sonar-project.properties || exit 2
          test "$SONAR_TOKEN" = dummy || exit 3
          printf '%s\n' "$2"
          exit "''\${TEST_SCANNER_STATUS:-0}"
        '';
      } ];
    }).config.quantile-co.factory.sonarqube;
  in cfg.check.package`;
  const output = execFileSync(
    "nix",
    [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expression,
    ],
    { encoding: "utf8", timeout: 120_000 },
  ).trim();
  const cwd = mkdtempSync(join(tmpdir(), "factory-sonarqube-"));
  try {
    const child = join(cwd, "nested");
    mkdirSync(child);
    const git = (...args: string[]) => execFileSync("git", args, { cwd });
    const run = (extra: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(join(output, "bin/check-sonarqube"), {
        cwd: child,
        encoding: "utf8",
        env: { ...process.env, SONAR_HOST_URL: "", SONAR_TOKEN: "", ...extra },
        timeout: 5_000,
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        output: (result.stdout + result.stderr).trim(),
      };
    };
    const configured = {
      SONAR_HOST_URL: "https://sonar.example.invalid",
      SONAR_TOKEN: "dummy",
    };
    expect(run()).toMatchObject({
      status: 0,
      output: expect.stringContaining("Skipping SonarQube"),
    });
    expect(run({ SONAR_TOKEN: "dummy" }).status).toBe(1);
    git("init", "-qb", "main");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    expect(run(configured)).toMatchObject({
      status: 1,
      output: expect.stringContaining(
        "Missing consumer-native sonar-project.properties",
      ),
    });
    writeFileSync(
      join(cwd, "sonar-project.properties"),
      "sonar.projectKey=test\n",
    );
    git("symbolic-ref", "HEAD", "refs/heads/topic");
    expect(run(configured)).toMatchObject({
      status: 0,
      output: expect.stringContaining("only analyzes origin/main"),
    });
    git("symbolic-ref", "HEAD", "refs/heads/main");
    const failed = run({ ...configured, TEST_SCANNER_STATUS: "9" });
    expect(failed.status, failed.output).toBe(9);
    expect(failed.output).toMatch(/^-Dsonar\.working\.directory=\//);
    expect(existsSync(failed.output.split("=")[1])).toBe(false);
    expect(run(configured).status).toBe(0);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
}, 150_000);
