import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps host krew plugins out of the kubectl wrapper PATH", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  in (pkgs.lib.evalModules {
    modules = [ f.nixModules.kubectl ]; specialArgs = { inherit pkgs; };
  }).config.quantile-co.factory.kubectl.safePackage`;
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
  const work = mkdtempSync(join(tmpdir(), "factory-kubectl-"));
  try {
    const plugins = join(work, ".krew/bin");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      join(plugins, "kubectl-probe"),
      "#!/bin/sh\necho unsafe-plugin\n",
      { mode: 0o700 },
    );
    const result = spawnSync(`${built.stdout.trim()}/bin/kubectl`, ["probe"], {
      env: { ...process.env, PATH: `${plugins}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("unsafe-plugin");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
