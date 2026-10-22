import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exposes Buf without generating sources or choosing consumer schema policy", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules { modules = [ f.nixModules.buf ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.buf.package.out`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const work = mkdtempSync(join(tmpdir(), "factory-buf-"));
  try {
    const source = join(work, "schema.proto");
    const original =
      'syntax="proto3";\npackage fixture;\nmessage Thing{string name=1;}\n';
    writeFileSync(source, original);
    const result = spawnSync(
      `${built.stdout.trim()}/bin/buf`,
      ["format", "-d", source],
      {
        cwd: work,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("message Thing");
    expect(readFileSync(source, "utf8")).toBe(original);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
