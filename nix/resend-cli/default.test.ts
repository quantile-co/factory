import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("provides Resend's webhook listener without host Node or credentials", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = pkgs.lib.evalModules { modules = [ f.nixModules.resend-cli ]; specialArgs = { inherit pkgs; }; };
    in cfg.config.quantile.resend-cli.package`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    {
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  expect(built.status, built.stderr).toBe(0);
  const home = mkdtempSync(join(tmpdir(), "factory-resend-"));
  try {
    const result = spawnSync(
      join(built.stdout.trim(), "bin/resend"),
      ["webhooks", "listen", "--help"],
      {
        env: { HOME: home, PATH: "/no-host-tools" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--forward-to");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 210_000);
