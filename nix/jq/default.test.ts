import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("provides jq without activating Prek or its hooks", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.jq ]; specialArgs = { inherit pkgs; };
  }).config.quantile-co.factory.jq.package`;
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
  const result = spawnSync(
    `${built.stdout.trim().split("\n")[0]}/bin/jq`,
    ["-er", ".plan.storage"],
    {
      input: '{"plan":{"storage":"gcs"}}',
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("gcs");
}, 150_000);
