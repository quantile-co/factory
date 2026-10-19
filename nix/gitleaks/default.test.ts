import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("rejects shallow Git history before running a Gitleaks scan", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-gitleaks-"));
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
    writeFileSync(join(work, "file.txt"), "public fixture\n");
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "file.txt"]).status).toBe(0);
    writeFileSync(join(work, ".git/shallow"), `${"0".repeat(40)}\n`);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.gitleaks ]; specialArgs = { inherit pkgs; };
    }).config.quantile.gitleaks.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const rejected = run(
      `${built.stdout.trim()}/bin/quantile-git-gitleaks`,
      [],
    );
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain(
      "requires an unshallow checkout",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
