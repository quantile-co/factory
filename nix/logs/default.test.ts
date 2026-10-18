import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("makes the pinned lnav CLI available without opening a log", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-logs-"));
  try {
    const evaluated = spawnSync(
      "nix",
      [
        "--extra-experimental-features",
        "nix-command flakes",
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
          pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
        in (pkgs.lib.evalModules {
          modules = [ f.nixModules.logs ];
          specialArgs = { inherit pkgs; };
        }).config.quantile.logs.lnav.package.out`,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (evaluated.error) throw evaluated.error;
    expect(evaluated.status, evaluated.stderr).toBe(0);
    const result = spawnSync(`${evaluated.stdout.trim()}/bin/lnav`, ["-V"], {
      cwd: work,
      env: {
        ...process.env,
        HOME: work,
        XDG_CONFIG_HOME: join(work, "config"),
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/^lnav \d+\.\d+\.\d+/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
