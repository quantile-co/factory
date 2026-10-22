import { spawnSync } from "node:child_process";
import {
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

it("validates a backend-free caller root without formatting it implicitly", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-tofu-root-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.opentofu ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.opentofu.check.package`;
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
      { encoding: "utf8", timeout: 120_000 },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    mkdirSync(join(work, ".terraform"));
    const productionMetadata = join(work, ".terraform/terraform.tfstate");
    writeFileSync(productionMetadata, "existing production backend metadata\n");
    const source = join(work, "main.tf");
    const original = 'resource "terraform_data" "example" {input="value"}\n';
    writeFileSync(source, original);
    const checked = spawnSync(
      join(built.stdout.trim(), "bin/check-terraform"),
      [],
      {
        cwd: work,
        env: {
          ...process.env,
          TF_DIR: work,
          TF_DATA_DIR: join(work, ".terraform"),
          QUANTILE_CO_FACTORY_STATE_DIR: join(work, "isolated-check-data"),
          TF_CLI_ARGS_init: "-backend=true",
          TF_LOG: "TRACE",
          TF_LOG_PATH: join(work, "unexpected-tofu.log"),
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (checked.error) throw checked.error;
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(original);
    expect(readFileSync(productionMetadata, "utf8")).toBe(
      "existing production backend metadata\n",
    );
    expect(existsSync(join(work, "isolated-check-data/tofu-check"))).toBe(true);
    expect(existsSync(join(work, "unexpected-tofu.log"))).toBe(false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);

it("checks nonempty source and formats only tracked regular Terraform files on explicit fix", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-tofu-fix-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.opentofu ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.opentofu;
    in [ cfg.nonempty.package cfg.format.package cfg.fix.package ]`;
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
    const paths = built.stdout.trim().split("\n");
    const exe = (suffix: string) =>
      join(
        paths.find((path) => path.endsWith(`-${suffix}`)) ?? "",
        `bin/${suffix}`,
      );
    const run = (bin: string, args: string[] = []) => {
      const result = spawnSync(bin, args, {
        cwd: work,
        env: { ...process.env, TF_DIR: work },
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(run("git", ["init", "-q"]).status).toBe(0);
    const source = join(work, "source with spaces.tf");
    const unformatted = 'resource "terraform_data" "fixture" {input="value"}\n';
    writeFileSync(source, unformatted);
    writeFileSync(join(work, "untracked.tf"), unformatted);
    const external = mkdtempSync(join(tmpdir(), "factory-tofu-external-"));
    const outside = join(external, "outside.tf");
    writeFileSync(outside, unformatted);
    try {
      symlinkSync(outside, join(work, "linked.tf"));
      const empty = join(work, "empty.tofu");
      writeFileSync(empty, " \t\n");
      expect(
        run("git", ["add", "source with spaces.tf", "linked.tf", "empty.tofu"])
          .status,
      ).toBe(0);
      const rejected = run(exe("check-terraform-nonempty"));
      expect(rejected.status).not.toBe(0);
      expect(rejected.output).toContain("Empty Terraform file:");
      expect(readFileSync(empty, "utf8")).toBe(" \t\n");
      rmSync(empty);
      expect(run("git", ["rm", "--cached", "empty.tofu"]).status).toBe(0);
      writeFileSync(join(work, "untracked-empty.tf"), "");
      writeFileSync(join(work, "not-terraform.txt"), "");
      expect(run("git", ["add", "not-terraform.txt"]).status).toBe(0);
      expect(run(exe("check-terraform-nonempty"), ["."]).status).toBe(0);
      writeFileSync(source, "\n");
      expect(
        run(exe("check-terraform-nonempty"), ["source with spaces.tf"]).status,
      ).not.toBe(0);
      expect(
        run(exe("check-terraform-nonempty"), ["not-terraform.txt"]).status,
      ).toBe(0);
      writeFileSync(source, unformatted);
      expect(run(exe("check-terraform-format")).status).not.toBe(0);
      expect(readFileSync(source, "utf8")).toBe(unformatted);
      expect(run(exe("fix-terraform")).status).toBe(0);
      expect(readFileSync(source, "utf8")).toContain('input = "value"');
      expect(readFileSync(join(work, "untracked.tf"), "utf8")).toBe(
        unformatted,
      );
      expect(readFileSync(outside, "utf8")).toBe(unformatted);
      rmSync(join(work, "untracked.tf"));
      rmSync(join(work, "linked.tf"));
      expect(run(exe("check-terraform-format")).status).toBe(0);
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
