import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("provides NSS certutil from the tools output without initializing a database", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.nss ]; specialArgs = { inherit pkgs; };
  }).config.quantile.nss.package.tools`;
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
  const help = spawnSync(`${built.stdout.trim()}/bin/certutil`, ["-H"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (help.error) throw help.error;
  expect(help.status).toBe(1);
  expect(help.stdout + help.stderr).toContain(
    "Add a certificate to the database",
  );
}, 150_000);
