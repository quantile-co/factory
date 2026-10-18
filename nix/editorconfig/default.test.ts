import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("exposes a readable native EditorConfig template to standalone consumers", () => {
  const root = new URL("../../", import.meta.url);
  const result = spawnSync(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "eval",
      "--raw",
      "--impure",
      "--expr",
      `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
         pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
         cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.editorconfig ]; specialArgs = { inherit pkgs; }; }).config;
     in builtins.readFile cfg.quantile.editorconfig.configFile`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    readFileSync(
      new URL("../../etc/editorconfig/.editorconfig", import.meta.url),
      "utf8",
    ),
  );
});
