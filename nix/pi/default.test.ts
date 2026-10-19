import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exposes readable native Pi settings and shared skills to a consumer", () => {
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
     in builtins.toJSON { settings = builtins.readFile cfg.quantile.pi.settingsFile; skills = toString cfg.quantile.pi.skillsDir; }`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (evaluated.error) throw evaluated.error;
  expect(evaluated.status, evaluated.stderr).toBe(0);
  const resolved = JSON.parse(evaluated.stdout);
  expect(JSON.parse(resolved.settings)).toEqual(
    JSON.parse(
      readFileSync(
        new URL("../../etc/pi/settings.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const name of ["deploy", "day-zero-deploy"]) {
    const skill = readFileSync(join(resolved.skills, name, "SKILL.md"), "utf8");
    expect(skill).toContain(`name: ${name}`);
    expect(skill).toContain("existing");
  }
});
