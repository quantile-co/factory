import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("sets a writable Emscripten cache only for an explicitly requested command", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-emscripten-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      modules = [ f.nixModules.emscripten ({ ... }: { quantile-co.factory.emscripten.package = pkgs.coreutils; }) ];
      specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.emscripten.cache.package`;
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
    const command = join(built.stdout.trim(), "bin/with-emscripten-cache");
    const state = join(work, "state with spaces");
    expect(existsSync(state)).toBe(false);
    const missing = spawnSync(command, ["/bin/true"], {
      cwd: work,
      env: { ...process.env, EMSCRIPTEN_STATE_DIR: "" },
    });
    expect(missing.status).not.toBe(0);
    expect(existsSync(state)).toBe(false);
    const result = spawnSync(
      command,
      ["/bin/sh", "-c", 'printf "%s" "$EM_CACHE"'],
      {
        cwd: work,
        env: { ...process.env, EMSCRIPTEN_STATE_DIR: state },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(join(state, "emscripten-cache"));
    expect(existsSync(result.stdout)).toBe(true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
