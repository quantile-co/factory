import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("lets a consumer select its own GCP executable without configuring cloud access", () => {
  const root = new URL("../../", import.meta.url);
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
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
         pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
         cfg = (pkgs.lib.evalModules {
           modules = [ f.nixModules.gcp { quantile.gcp.gcloud.package = pkgs.hello; } ];
           specialArgs = { inherit pkgs; };
         }).config;
     in cfg.quantile.gcp.gcloud.package`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  const hello = spawnSync(`${result.stdout.trim()}/bin/hello`, [], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (hello.error) throw hello.error;
  expect(hello.status, hello.stderr).toBe(0);
  expect(hello.stdout).toContain("Hello, world!");
});
