import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("exports a usable Commitizen CLI and its native configuration independently of Git hooks", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.commitizen ]; specialArgs = { inherit pkgs; };
  }).config.quantile.commitizen.package`;
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
  const config = readFileSync(
    new URL("../../etc/commitizen/.cz.toml", import.meta.url),
    "utf8",
  );
  expect(config).toContain("[tool.commitizen]");
  const version = spawnSync(
    `${built.stdout.trim().split("\n")[0]}/bin/cz`,
    ["version"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (version.error) throw version.error;
  expect(version.status, version.stderr).toBe(0);
  expect(version.stdout + version.stderr).toMatch(/\d+\.\d+/);
}, 150_000);
