import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("validates selected WASM binaries without executing or rewriting them", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-wasm-tools-"));
  const outside = mkdtempSync(join(tmpdir(), "factory-wasm-tools-outside-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in [ (pkgs.lib.evalModules { modules = [ f.nixModules.wasm-tools ]; specialArgs = { inherit pkgs; }; }).config.quantile.wasm-tools.check.package pkgs.wabt ]`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 200_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const paths = built.stdout.trim().split("\n");
    const check = join(
      paths.find((path) => path.endsWith("-check-wasm-tools")) ?? "",
      "bin/check-wasm-tools",
    );
    const wabt = paths.find((path) => /-wabt-\d/.test(path));
    if (!wabt) throw new Error("Expected WABT package for fixture generation");
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
    const binary = join(work, "module with spaces.wasm");
    const wat = join(work, "source.wat");
    writeFileSync(
      wat,
      '(module (func (export "answer") (result i32) i32.const 42))\n',
    );
    const compiled = spawnSync(
      join(wabt, "bin/wat2wasm"),
      [wat, "-o", binary],
      { encoding: "utf8" },
    );
    expect(compiled.status, compiled.stderr).toBe(0);
    expect(
      spawnSync("git", ["add", "module with spaces.wasm"], { cwd: work })
        .status,
    ).toBe(0);
    expect(run().status).toBe(0);
    const broken = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 255]);
    writeFileSync(binary, broken);
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toMatch(/end-of-file|unexpected|invalid|failed/);
    expect(readFileSync(binary)).toEqual(broken);
    rmSync(binary);
    const external = join(outside, "external.wasm");
    writeFileSync(external, broken);
    symlinkSync(external, join(work, "linked.wasm"));
    expect(run().status).toBe(0);
    expect(run([":(bad)"]).status).not.toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 230_000);
