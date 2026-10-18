import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("makes jq available to a standalone JSON consumer", () => {
  const root = new URL("../../", import.meta.url);
  const evaluated = spawnSync(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "build",
      "--no-link",
      "--print-out-paths",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
         pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
     in (pkgs.lib.evalModules { modules = [ f.nixModules.json ]; specialArgs = { inherit pkgs; }; }).config.quantile.json.jq.package`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (evaluated.error) throw evaluated.error;
  expect(evaluated.status, evaluated.stderr).toBe(0);
  const jq = `${evaluated.stdout.trim().split("\n")[0]}/bin/jq`;
  const parsed = spawnSync(jq, ["-er", ".plan.storage"], {
    input: '{"plan":{"storage":"gcs"}}',
    encoding: "utf8",
  });
  if (parsed.error) throw parsed.error;
  expect(parsed.status, parsed.stderr).toBe(0);
  expect(parsed.stdout.trim()).toBe("gcs");
});
