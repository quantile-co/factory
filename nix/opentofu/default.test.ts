import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("validates a backend-free caller root without formatting it implicitly", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-tofu-root-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.opentofu ]; specialArgs = { inherit pkgs; }; }).config.quantile.opentofu.check.package`;
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
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (checked.error) throw checked.error;
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
