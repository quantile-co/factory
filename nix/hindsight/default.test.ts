import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("renders independent consumer configuration and replacement Pi settings", () => {
  const root = new URL("../../", import.meta.url);
  const result = execFileSync(
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
      cfg = (pkgs.lib.evalModules {
        modules = [ f.nixModules.pi f.nixModules.hindsight
          { quantile-co.factory.hindsight = { bankId = "example--project"; }; } ];
        specialArgs = { inherit pkgs; llmAgents = f.inputs.llm-agents; };
      }).config.quantile-co.factory.hindsight;
    in { config = cfg.configFile; settings = cfg.piSettingsFile; hook = cfg.shellHook;
      derivations = [ cfg.configFile.drvPath cfg.piSettingsFile.drvPath ]; }`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  const paths = JSON.parse(result) as {
    config: string;
    settings: string;
    hook: string;
    derivations: string[];
  };
  // Realise derivations, not output paths whose build recipes were never requested.
  execFileSync(
    "nix-store",
    ["--option", "substituters", "", "--realise", ...paths.derivations],
    {
      timeout: 120_000,
    },
  );
  const config = JSON.parse(readFileSync(paths.config, "utf8"));
  const settings = JSON.parse(readFileSync(paths.settings, "utf8"));
  expect(config.bankId).toBe("example--project");
  expect(config).not.toHaveProperty("factory");
  expect(config).not.toHaveProperty("apiToken");
  expect(
    settings.packages.some(
      (p: unknown) => typeof p === "string" && p.startsWith("npm:pi-memory"),
    ),
  ).toBe(false);
  expect(settings.packages[0].extensions).toEqual(["dist/index.js"]);
  expect(settings.packages).toContain(
    "npm:@vectorize-io/hindsight-coding-agents@0.8.7",
  );
  expect(settings.extensions).toContain(
    "./npm/node_modules/@vectorize-io/hindsight-coding-agents/dist/pi.js",
  );
  expect(settings.packages[0].skills).toEqual([]);
  expect(paths.hook).toContain("HINDSIGHT_CONFIG");
  expect(paths.hook).not.toContain("HINDSIGHT_API_TOKEN");
}, 180_000);
