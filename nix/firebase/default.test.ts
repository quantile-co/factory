import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps loopback emulator defaults and deny-all Rules when a site adds hosting", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let
    f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    config = (pkgs.lib.evalModules { modules = [ f.nixModules.firebase f.nixModules.biome ]; specialArgs = { inherit pkgs; }; }).config;
  in [
    (config.quantile-co.factory.firebase.withOverrides { hosting.public = "out"; })
    (pkgs.writeText "firestore.rules" (builtins.readFile config.quantile-co.factory.firebase.rulesFile))
  ]`;
  const result = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  const [configFile, rulesFile] = result.stdout.trim().split("\n");
  const rendered = JSON.parse(readFileSync(configFile, "utf8"));
  expect(rendered).toMatchObject({
    hosting: { public: "out" },
    firestore: { rules: "firestore.rules" },
    emulators: {
      firestore: { host: "127.0.0.1", port: 8080 },
      ui: { enabled: false },
    },
  });
  const rules = readFileSync(rulesFile, "utf8");
  expect(rules).toContain("rules_version = '2'");
  expect(rules).toContain("allow read, write: if false;");
  expect(rules).not.toContain("if true;");
}, 150_000);
