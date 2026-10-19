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

it("scans source with native offline policy, skips build output, and reports a real IaC finding", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-trivy-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.trivy ]; specialArgs = { inherit pkgs; }; }).config.quantile.trivy.check.package`;
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
    const check = join(built.stdout.trim(), "bin/check-trivy");
    const run = (args: string[] = []) => {
      const result = spawnSync(check, args, {
        cwd: work,
        env: { ...process.env, TRIVY_CACHE_DIR: join(work, "cache") },
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const config = join(work, "trivy.yaml");
    copyFileSync(
      new URL("../../etc/trivy/trivy.yaml", import.meta.url),
      config,
    );
    const offline = readFileSync(config, "utf8")
      .replace(
        "  no-progress: true",
        "  no-progress: true\n  skip-update: true\n  java-skip-update: true",
      )
      .replace("  skip-check-update: false", "  skip-check-update: true")
      .replace(
        "  scanners: [vuln, misconfig, secret]",
        "  scanners: [misconfig]",
      )
      .replace(
        "  disable-telemetry: true",
        "  disable-telemetry: true\n  offline: true",
      );
    writeFileSync(config, offline);
    const scanRoot = "iac with spaces";
    mkdirSync(join(work, scanRoot, "build"), { recursive: true });
    const rejected = `resource "google_storage_bucket" "unsafe" {
  name                     = "synthetic-scanner-fixture"
  public_access_prevention = "inherited"
}
resource "google_storage_bucket_iam_binding" "public_reader" {
  bucket  = google_storage_bucket.unsafe.name
  role    = "roles/storage.objectViewer"
  members = ["allUsers"]
}
`;
    writeFileSync(join(work, scanRoot, "build/output.tf"), rejected);
    const ignoredBuild = run([scanRoot]);
    expect(ignoredBuild.status, ignoredBuild.output).toBe(0);
    const source = join(work, scanRoot, "rejected.tf");
    writeFileSync(source, rejected);
    const found = run([scanRoot]);
    expect(found.status).not.toBe(0);
    expect(found.output).toContain("GCP-0001");
    expect(readFileSync(source, "utf8")).toBe(rejected);
    const missing = run(["missing-root"]);
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("Missing Trivy scan directory");
    rmSync(config);
    expect(run([scanRoot]).output).toContain(
      "requires consumer-native trivy.yaml",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 200_000);
