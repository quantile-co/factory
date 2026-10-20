import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("provides source hashing without host core utilities", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.coreutils ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile.coreutils.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const input = "reviewed source\n";
  const result = spawnSync(`${built.stdout.trim()}/bin/sha256sum`, [], {
    env: { PATH: "/no-host-tools" },
    input,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(
    `${createHash("sha256").update(input).digest("hex")}  -`,
  );
}, 150_000);
