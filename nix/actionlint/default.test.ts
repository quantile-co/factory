import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("a standalone consumer can use the public module and its own native configuration", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-consumer-"));
  const consumer = join(work, "consumer");
  const home = join(work, "home");
  // Git-aware input includes tracked edits, not ignored credentials or local state.
  const factory = `git+${new URL("../../", import.meta.url).href}`;
  try {
    mkdirSync(home);
    mkdirSync(join(consumer, ".github", "workflows"), { recursive: true });
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      TMPDIR: work,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, {
        cwd: consumer,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      expect(
        result.status,
        `${command}:\n${result.stdout}\n${result.stderr}`,
      ).toBe(0);
      return result.stdout.trim();
    };

    writeFileSync(
      join(consumer, "flake.nix"),
      `
{
  inputs.factory.url = ${JSON.stringify(factory)};
  outputs = { factory, ... }: {
    packages = builtins.mapAttrs (_: pkgs: {
      default = (pkgs.lib.evalModules {
        modules = [ factory.nixModules.default ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.actionlint.check.package;
    }) factory.inputs.nixpkgs.legacyPackages;
  };
}
`,
    );
    writeFileSync(
      join(consumer, ".github", "actionlint.yaml"),
      `
self-hosted-runner:
  labels: [consumer-runner]
`,
    );
    writeFileSync(
      join(consumer, ".github", "workflows", "check.yaml"),
      `
name: Consumer
on: push
jobs:
  check:
    runs-on: consumer-runner
    steps:
      - run: echo consumer
`,
    );

    // Only this synthetic, credential-free consumer uses a path input.
    const output = run("nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "build",
      "path:.#default",
      "--no-link",
      "--print-out-paths",
    ]);
    run("git", ["init", "--quiet", "--initial-branch=main"]);
    const checker = join(output, "bin", "check-actionlint");
    run(checker, []);

    const workflow = join(consumer, ".github/workflows/check.yaml");
    const invalid = `name: Consumer\non: push\njobs:\n  check:\n    runs-on: consumer-runner\n    steps:\n      - run: echo $GITHUB_WORKSPACE\n`;
    writeFileSync(workflow, invalid);
    const rejected = spawnSync(checker, [], {
      cwd: consumer,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (rejected.error) throw rejected.error;
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain("SC2086");
    expect(readFileSync(workflow, "utf8")).toBe(invalid);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
