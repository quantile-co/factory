import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("selects a usable Go toolchain without running a project build", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.go ]; specialArgs = { inherit pkgs; };
  }).config.quantile.go.package`;
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
  const version = spawnSync(`${built.stdout.trim()}/bin/go`, ["version"], {
    encoding: "utf8",
    env: { ...process.env, GOTOOLCHAIN: "local" },
    timeout: 30_000,
  });
  if (version.error) throw version.error;
  expect(version.status, version.stderr).toBe(0);
  expect(version.stdout).toMatch(/^go version go\d+/);
}, 180_000);
