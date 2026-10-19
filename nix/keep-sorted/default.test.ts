import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("checks annotated blocks read-only and fixes only selected tracked text on request", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-keep-sorted-"));
  const repo = join(work, "repo");
  const accepted =
    "outside before\n# keep-sorted start\nalpha\nomega\n# keep-sorted end\noutside after\n";
  const unsorted = accepted.replace("alpha\nomega", "omega\nalpha");
  const malformed = unsorted.replace("# keep-sorted end\noutside after\n", "");
  try {
    mkdirSync(join(repo, "source with spaces"), { recursive: true });
    mkdirSync(join(repo, "excluded"));
    const target = join(repo, "source with spaces/list.txt");
    const excluded = join(repo, "excluded/list.txt");
    const external = join(work, "external.txt");
    const binary = join(repo, "binary.bin");
    const config = join(repo, ".pre-commit-config.yaml");
    writeFileSync(target, accepted);
    writeFileSync(excluded, unsorted);
    writeFileSync(external, unsorted);
    writeFileSync(
      binary,
      Buffer.concat([Buffer.from([0]), Buffer.from(unsorted)]),
    );
    symlinkSync(external, join(repo, "linked.txt"));
    copyFileSync(
      new URL("../../etc/prek/.pre-commit-config.yaml", import.meta.url),
      config,
    );
    const run = (command: string, args: string[] = []) => {
      const result = spawnSync(command, args, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
        encoding: "utf8",
        timeout: 90_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.keep-sorted ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.keep-sorted.${selector}.package`;
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
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const check = join(build("check"), "bin/check-keep-sorted");
    const fix = join(build("fix"), "bin/fix-keep-sorted");
    expect(run(check).status).not.toBe(0); // The template's lint hook is manual until opted in.
    writeFileSync(
      config,
      readFileSync(config, "utf8")
        .replace(
          "entry: keep-sorted --mode lint\n        language: system\n        stages: [manual]",
          "entry: keep-sorted --mode lint\n        language: system\n        stages: [pre-push]",
        )
        .replace(
          "exclude: &keep-sorted-excludes '^$'",
          "exclude: &keep-sorted-excludes '\\.(source|bad)$|^excluded/'",
        ),
    );
    expect(run(check).status).toBe(0);
    expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(false);
    writeFileSync(target, unsorted);
    const rejected = run(check);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("These lines are out of order");
    expect(readFileSync(target, "utf8")).toBe(unsorted);
    const untracked = join(repo, "untracked.txt");
    writeFileSync(untracked, unsorted);
    const repaired = run(fix);
    expect(repaired.status, repaired.output).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(accepted);
    expect(readFileSync(excluded, "utf8")).toBe(unsorted);
    expect(readFileSync(external, "utf8")).toBe(unsorted);
    expect(readFileSync(untracked, "utf8")).toBe(unsorted);
    expect(readFileSync(binary)).toEqual(
      Buffer.concat([Buffer.from([0]), Buffer.from(unsorted)]),
    );
    expect(run(fix).status).toBe(0);
    expect(run(check).status).toBe(0);

    writeFileSync(target, malformed);
    for (const command of [check, fix]) {
      const invalid = run(command);
      expect(invalid.status).not.toBe(0);
      expect(invalid.output).toContain("doesn't have matching");
      expect(readFileSync(target, "utf8")).toBe(malformed);
    }
    writeFileSync(target, accepted);
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace(
        "exclude: &keep-sorted-excludes '\\.(source|bad)$|^excluded/'",
        () => "exclude: &keep-sorted-excludes '^$'",
      ),
    );
    const included = run(check);
    expect(included.status).not.toBe(0);
    expect(included.output).toContain("excluded/list.txt");
    expect(readFileSync(excluded, "utf8")).toBe(unsorted);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 200_000);
