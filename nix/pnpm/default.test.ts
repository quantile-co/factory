import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("selects pnpm without installing consumer dependencies", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules { modules = [ f.nixModules.pnpm ]; specialArgs = { inherit pkgs; }; }).config.quantile.pnpm.package`;
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
  const version = spawnSync(
    `${built.stdout.trim().split("\n")[0]}/bin/pnpm`,
    ["--version"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (version.error) throw version.error;
  expect(version.status, version.stderr).toBe(0);
  expect(version.stdout).toMatch(/^\d+\.\d+/);
}, 150_000);
