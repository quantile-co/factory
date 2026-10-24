#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
function run(
  command: string,
  args: string[] = [],
  extra: NodeJS.ProcessEnv = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    throw new Error("Interrupted");
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const [action, ...args] = process.argv.slice(2);
if (args.length) throw new Error("Unexpected repository task arguments");
switch (action) {
  case "check":
    run("factory-files", ["check"]);
    run("nix", ["flake", "check", "."]);
    for (const check of [
      "check-git-hooks",
      "check-nixfmt",
      "check-deadnix",
      "check-statix",
      "check-editorconfig",
      "check-shellcheck",
      "check-shfmt",
      "check-markdown",
      "check-actionlint",
      "check-semgrep",
      "check-trivy",
      "check-typos",
      "check-vale",
      "check-yamllint",
      "check-taplo",
      "check-taplo-format",
    ]) {
      if (check === "check-semgrep")
        run("test-semgrep", [], { SEMGREP_TESTS_DIR: ".semgrep/tests" });
      run(check);
    }
    run("check-terraform-nonempty", ["tf"]);
    run("check-terraform-format", [], { TF_DIR: "tf" });
    run("check-terraform", [], { TF_DIR: "tf/infrastructure" });
    run("check-tflint", [], { TF_DIR: "tf/infrastructure" });
    for (const [path, namespace] of [
      ["tf/infrastructure", "terraform.infrastructure"],
      ["tf/modules/project/github", "terraform.project.github"],
      ["tf/modules/project/gcp", "terraform.project.gcp"],
    ])
      run("check-opa", [
        "--policy",
        path,
        "--namespace",
        namespace,
        "--",
        `${path}/main.tf`,
      ]);
    run("pnpm", ["exec", "tsc", "--noEmit"]);
    run("pnpm", [
      "exec",
      "biome",
      "check",
      "--error-on-warnings",
      "nix",
      "tf",
      "apps",
      "packages",
      "package.json",
      "tsconfig.json",
      "turbo.json",
      "etc/biome",
      "etc/pnpm",
      "etc/turbo",
    ]);
    break;
  case "test":
    run("pnpm", [
      "exec",
      "vitest",
      "run",
      "nix",
      "tf",
      "--exclude",
      "packages/**",
      "--maxWorkers=4",
    ]);
    break;
  case "fix":
    run("factory-files", ["write"]);
    run("fix-terraform", [], { TF_DIR: "tf" });
    for (const fix of [
      "fix-nixfmt",
      "fix-shfmt",
      "fix-taplo",
      "fix-editorconfig-eof",
    ])
      run(fix);
    run("pnpm", [
      "exec",
      "biome",
      "check",
      "--write",
      "--error-on-warnings",
      "nix",
      "tf",
      "apps",
      "packages",
      "package.json",
      "tsconfig.json",
      "turbo.json",
      "etc/biome",
      "etc/pnpm",
      "etc/turbo",
    ]);
    break;
  default:
    throw new Error("Expected check, fix or test");
}
