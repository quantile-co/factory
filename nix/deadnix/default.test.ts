import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("detects an unused Nix binding without modifying an untracked source file", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-deadnix-"));
  const run = (bin: string, args: string[]) => {
    const result = spawnSync(bin, args, {
      cwd: work,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    return result;
  };
  try {
    const source = join(work, "unused.nix");
    const original = "let unused = 1; in { }\n";
    writeFileSync(source, original);
    expect(run("git", ["init", "-q"]).status).toBe(0);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.deadnix ]; specialArgs = { inherit pkgs; }; }).config.quantile.deadnix.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const result = run(`${built.stdout.trim()}/bin/check-deadnix`, [
      "unused.nix",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Unused let binding");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
