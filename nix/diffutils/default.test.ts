import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("compares exact bytes without host file comparison tools", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.diffutils ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile.diffutils.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const work = mkdtempSync(join(tmpdir(), "factory-cmp-"));
  try {
    const file = join(work, "source");
    writeFileSync(file, "reviewed source\n");
    const compare = (input: string) =>
      spawnSync(`${built.stdout.trim()}/bin/cmp`, [file, "-"], {
        env: { PATH: "/no-host-tools" },
        input,
        encoding: "utf8",
      });
    expect(compare("reviewed source\n").status).toBe(0);
    expect(compare("changed source\n").status).toBe(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
