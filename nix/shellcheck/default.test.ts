import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs ShellCheck independently and catches unsafe unquoted shell expansion", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules { modules = [ f.nixModules.shellcheck ]; specialArgs = { inherit pkgs; }; }).config.quantile.shellcheck.package`;
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
    `${built.stdout.trim().split("\n")[0]}/bin/shellcheck`,
    ["-s", "bash", "-"],
    {
      input: "#!/bin/bash\necho $GITHUB_WORKSPACE\n",
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("SC2086");
}, 150_000);
