import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("provides ngrok offline after explicit consumer license permission", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = import f.inputs.nixpkgs { system = builtins.currentSystem;
      config.allowUnfreePredicate = p: (p.pname or "") == "ngrok"; };
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.ngrok ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile-co.factory.ngrok.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const home = mkdtempSync(join(tmpdir(), "factory-ngrok-"));
  try {
    const result = spawnSync(
      join(built.stdout.trim(), "bin/ngrok"),
      ["http", "--help"],
      {
        env: { HOME: home, PATH: "/no-host-tools" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--url");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 210_000);
