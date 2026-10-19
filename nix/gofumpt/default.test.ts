import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("provides the real gofumpt formatter independently of Go lint", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.gofumpt ]; specialArgs = { inherit pkgs; };
  }).config.quantile.gofumpt.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 150_000,
    },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const work = mkdtempSync(join(tmpdir(), "factory-gofumpt-"));
  try {
    const source = join(work, "bad.go");
    const original = "package fixture\nfunc Answer()int{return 42}\n";
    writeFileSync(source, original);
    const formatter = `${built.stdout.trim()}/bin/gofumpt`;
    const result = spawnSync(formatter, ["-l", source], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("bad.go");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
