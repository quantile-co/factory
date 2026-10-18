import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs an in-memory DuckDB query without creating a database and permits package overrides", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-duckdb-"));
  try {
    const build = (override = "") => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.duckdb ${override} ];
        specialArgs = { inherit pkgs; };
      }).config.quantile.duckdb.package`;
      const result = spawnSync(
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
        { encoding: "utf8", timeout: 150_000 },
      );
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split("\n")[0];
    };
    const duckdb = join(build(), "bin/duckdb");
    for (const args of [
      ["--version"],
      [":memory:", "-csv", "-c", "select 21 * 2 as answer;"],
    ]) {
      const result = spawnSync(duckdb, args, { cwd: work, encoding: "utf8" });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
      if (args.length > 1) expect(result.stdout).toContain("answer\n42");
      else expect(result.stdout.trim()).not.toBe("");
    }
    expect(readdirSync(work)).toEqual([]);

    const overridden = join(
      build("{ quantile.duckdb.package = pkgs.hello; }"),
      "bin/hello",
    );
    const hello = spawnSync(overridden, [], { encoding: "utf8" });
    if (hello.error) throw hello.error;
    expect(hello.status, hello.stderr).toBe(0);
    expect(hello.stdout).toContain("Hello, world!");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
