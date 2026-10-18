import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("tests caller-owned Semgrep rules and rejects matching source without modifying it", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-semgrep-consumer-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.semgrep ]; specialArgs = { inherit pkgs; }; }).config.quantile.semgrep.check.package`;
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
    cpSync(
      fileURLToPath(new URL("../../etc/semgrep", import.meta.url)),
      join(work, ".semgrep"),
      { recursive: true },
    );
    const source = join(work, "bad.tf");
    const original =
      'variable "password" {\n  type = string\n  sensitive = true\n}\n';
    writeFileSync(source, original);
    const checked = spawnSync(
      join(built.stdout.trim(), "bin/check-semgrep"),
      [],
      {
        cwd: work,
        env: { ...process.env, SEMGREP_RULES_DIR: ".semgrep" },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (checked.error) throw checked.error;
    expect(checked.status).not.toBe(0);
    expect(checked.stdout + checked.stderr).toContain(
      "terraform-sensitive-input-must-be-ephemeral",
    );
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
