import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("provides Bash without an ambient shell or startup configuration", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.bash ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile.bash.package.out`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const result = spawnSync(
    `${built.stdout.trim()}/bin/bash`,
    [
      "--noprofile",
      "--norc",
      "-euo",
      "pipefail",
      "-c",
      'read -r first second <<< "one two"; printf "%s" "$second"',
    ],
    { env: { PATH: "/no-host-tools" }, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("two");
}, 150_000);
