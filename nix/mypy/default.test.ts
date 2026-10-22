import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("checks a consumer with mypy alone, without rewriting source", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-mypy-"));
  const source = join(work, "bad.py");
  const original = "def value() -> str:\n    return 42\n";
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
    copyFileSync(
      new URL("../../etc/mypy/mypy.ini", import.meta.url),
      join(work, "mypy.ini"),
    );
    writeFileSync(source, original);
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "bad.py"]).status).toBe(0);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.mypy ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.mypy.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const result = run(join(built.stdout.trim(), "bin/check-python-mypy"), []);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("[return-value]");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
