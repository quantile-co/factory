import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs standalone Conftest policy checks without changing the selected workload", () => {
  const work = mkdtempSync(join(tmpdir(), "factory-conftest-"));
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
    mkdirSync(join(work, "policy"));
    writeFileSync(
      join(work, "policy/main.rego"),
      'package main\nimport rego.v1\ndeny contains "rejected" if { input.version < 2 }\n',
    );
    const source = join(work, "workload.json");
    const original = '{"version":1}\n';
    writeFileSync(source, original);
    expect(run("git", ["init", "-q"]).status).toBe(0);
    expect(run("git", ["add", "workload.json"]).status).toBe(0);
    const root = new URL("../../", import.meta.url);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.conftest ]; specialArgs = { inherit pkgs; }; }).config.quantile.conftest.check.package`;
    const built = run("nix", [
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      expr,
    ]);
    expect(built.status, built.stderr).toBe(0);
    const result = run(`${built.stdout.trim()}/bin/check-opa`, [
      "--policy",
      "policy",
      "--namespace",
      "main",
      "--",
      "workload.json",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("rejected");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
