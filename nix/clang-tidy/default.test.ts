import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("requires a local compilation database for a standalone clang-tidy check", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-clang-tidy-"));
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, {
      cwd: work,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    return result;
  };
  try {
    writeFileSync(join(work, "main.c"), "int main(void) { return 0; }\n");
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "main.c"]).status).toBe(0);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.clang-tidy ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.clang-tidy.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const checked = run(`${built.stdout.trim()}/bin/check-clang-tidy`, [
      "main.c",
    ]);
    expect(checked.status).not.toBe(0);
    expect(checked.stdout + checked.stderr).toContain(
      "requires a compilation database",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
