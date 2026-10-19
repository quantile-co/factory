import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("parses selected WAT text without emitting binaries or following symlinks", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-wabt-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-wabt-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.wabt ]; specialArgs = { inherit pkgs; }; }).config.quantile.wabt.check.package`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 180_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const check = join(built.stdout.trim(), "bin/check-wabt");
    const run = (args: string[] = []) => {
      const result = spawnSync(check, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const file = join(work, "module with spaces.wat");
    const valid =
      '(module (func (export "answer") (result i32) i32.const 42))\n';
    writeFileSync(file, valid);
    expect(
      spawnSync("git", ["add", "module with spaces.wat"], { cwd: work }).status,
    ).toBe(0);
    const accepted = run();
    expect(accepted.status, accepted.output).toBe(0);
    expect(existsSync(join(work, "module with spaces.wasm"))).toBe(false);
    const invalid = "(module (unknown))\n";
    writeFileSync(file, invalid);
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("unexpected token");
    expect(readFileSync(file, "utf8")).toBe(invalid);
    writeFileSync(file, valid);
    writeFileSync(join(work, ".gitignore"), "ignored.wat\n");
    writeFileSync(join(work, "ignored.wat"), invalid);
    const external = join(outside, "outside.wat");
    writeFileSync(external, invalid);
    symlinkSync(external, join(work, "linked.wat"));
    expect(run().status).toBe(0);
    expect(run([":(bad)"]).status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 210_000);
