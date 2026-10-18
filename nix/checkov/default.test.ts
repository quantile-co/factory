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
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("scans explicit consumer roots read-only with isolated Checkov and local CKV rules", () => {
  const factory = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-checkov-consumer-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${factory.href}`)};
         pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
         cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.checkov ]; specialArgs = { inherit pkgs; }; }).config;
     in cfg.quantile.checkov.check.package`;
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
    const checker = join(built.stdout.trim(), "bin/check-checkov");
    const closure = spawnSync(
      "nix-store",
      ["--query", "--requisites", built.stdout.trim()],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (closure.error) throw closure.error;
    expect(closure.status, closure.stderr).toBe(0);
    expect(closure.stdout).toContain("-checkov-3.2.527");
    expect(closure.stdout).not.toContain("-ecdsa-");

    spawnSync("git", ["init", "--quiet", "--initial-branch=main", work], {
      encoding: "utf8",
    });
    const root = join(work, "space root");
    mkdirSync(root);
    const configFile = join(work, ".checkov.yaml");
    const template = readFileSync(
      fileURLToPath(
        new URL("../../etc/checkov/.checkov.yaml", import.meta.url),
      ),
      "utf8",
    );
    const config =
      template.replace("  - tf\n", '  - "space root"\n') +
      "check: [CKV_GCP_114]\n";
    writeFileSync(configFile, config);
    const file = join(root, "main.tf");
    const source = (
      prevention: string,
    ) => `resource "google_storage_bucket" "fixture" {
  name                        = "quantile-checkov-fixture"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "${prevention}"
}\n`;
    const run = (args: string[]) => {
      const result = spawnSync(checker, args, {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const failing = source("inherited");
    writeFileSync(file, failing);
    const rejected = run([]);
    expect(rejected.status, rejected.output).not.toBe(0);
    expect(rejected.output).toContain("CKV_GCP_114");
    expect(readFileSync(file, "utf8")).toBe(failing);

    writeFileSync(file, source("enforced"));
    const accepted = run([]);
    expect(accepted.status, accepted.output).toBe(0);
    writeFileSync(
      configFile,
      config.replace('  - "space root"\n', '  - "missing root"\n'),
    );
    const missing = run([]);
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain(
      "Missing Checkov scan directory: missing root",
    );
    writeFileSync(
      configFile,
      config.replace("\ncheck: [CKV_GCP_114]\n", "\ncheck: [HIGH]\n"),
    );
    const severity = run([]);
    expect(severity.status).not.toBe(0);
    expect(severity.output).toContain("local CKV IDs");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
