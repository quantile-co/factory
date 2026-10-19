import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("reports an empty Nix pattern without rewriting tracked source", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-statix-"));
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
    const source = join(work, "pattern.nix");
    const original = "{ }: { }\n";
    writeFileSync(source, original);
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "pattern.nix"]).status).toBe(0);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.statix ]; specialArgs = { inherit pkgs; }; }).config.quantile.statix.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const result = run(`${built.stdout.trim()}/bin/check-statix`, []);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("empty pattern");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
