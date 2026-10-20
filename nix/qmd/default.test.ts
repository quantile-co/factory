import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps the QMD output identity while substituting external fetchers", () => {
  const root = new URL("../../", import.meta.url);
  const result = spawnSync(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--json",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
  pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.qmd ]; specialArgs = { inherit pkgs; }; }).config;
in { selected = cfg.quantile.qmd.package.outPath;
  upstream = f.inputs.llm-agents.packages.\${builtins.currentSystem}.qmd.outPath; }`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  const paths = JSON.parse(result.stdout) as {
    selected: string;
    upstream: string;
  };
  expect(paths.selected).toBe(paths.upstream);
}, 120_000);
