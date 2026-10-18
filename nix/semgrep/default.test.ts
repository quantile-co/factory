import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
      fileURLToPath(new URL("../../etc/semgrep/rules", import.meta.url)),
      join(work, ".semgrep"),
      { recursive: true },
    );
    copyFileSync(
      fileURLToPath(
        new URL("../../etc/semgrep/.semgrepignore", import.meta.url),
      ),
      join(work, ".semgrepignore"),
    );
    const source = join(work, "bad.tf");
    const original =
      'variable "password" {\n  type = string\n  sensitive = true\n}\n';
    writeFileSync(source, original);
    const run = () => {
      const result = spawnSync(
        join(built.stdout.trim(), "bin/check-semgrep"),
        [],
        {
          cwd: work,
          encoding: "utf8",
          timeout: 120_000,
        },
      );
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const checked = run();
    expect(checked.status).not.toBe(0);
    expect(checked.output).toContain(
      "terraform-sensitive-input-must-be-ephemeral",
    );
    expect(checked.output).toContain("bad.tf");
    expect(readFileSync(source, "utf8")).toBe(original);
    writeFileSync(
      source,
      original.replace(
        "sensitive = true",
        "sensitive = true\n  ephemeral = true",
      ),
    );
    const clean = run();
    expect(clean.status, clean.output).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
