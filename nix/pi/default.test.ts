import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("exposes readable native Pi settings without placing them in the consumer checkout", () => {
  const root = new URL("../../", import.meta.url);
  const evaluated = spawnSync(
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
         cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.pi ]; specialArgs = { inherit pkgs; }; }).config;
     in builtins.readFile cfg.quantile.pi.settingsFile`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (evaluated.error) throw evaluated.error;
  expect(evaluated.status, evaluated.stderr).toBe(0);
  expect(JSON.parse(evaluated.stdout)).toEqual(
    JSON.parse(
      readFileSync(
        new URL("../../etc/pi/settings.json", import.meta.url),
        "utf8",
      ),
    ),
  );
});
