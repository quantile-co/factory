import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("lets a consumer select the Python interpreter independently of Ruff and mypy", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.python { quantile.python.package = pkgs.python312; } ];
    specialArgs = { inherit pkgs; };
  }).config.quantile.python.package.pythonVersion`;
  const result = spawnSync(
    "nix",
    ["eval", "--raw", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("3.12");
});
