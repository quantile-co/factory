import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs CMake from Nix and permits a consumer package override", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-cmake-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      evaluate = override: (pkgs.lib.evalModules {
        modules = [ f.nixModules.cmake override ]; specialArgs = { inherit pkgs; };
      }).config.quantile-co.factory.cmake.package;
    in [ (evaluate {}).out (evaluate { quantile-co.factory.cmake.package = pkgs.hello; }).out ]`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 150_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const outputs = built.stdout.trim().split("\n");
    const overridden = outputs.find((path) =>
      existsSync(join(path, "bin/hello")),
    );
    const normal = outputs.find((path) => path !== overridden);
    expect(outputs).toHaveLength(2);
    if (!normal || !overridden) throw new Error(built.stdout);
    const version = spawnSync(join(normal, "bin/cmake"), ["--version"], {
      cwd: work,
      encoding: "utf8",
      timeout: 30_000,
    });
    if (version.error) throw version.error;
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout + version.stderr).toMatch(/\d/);
    const hello = spawnSync(join(overridden, "bin/hello"), [], {
      cwd: work,
      encoding: "utf8",
    });
    if (hello.error) throw hello.error;
    expect(hello.status, hello.stderr).toBe(0);
    expect(hello.stdout).toContain("Hello, world!");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
