import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("provides overridable gopls without launching a language server", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    pkg = override: (pkgs.lib.evalModules {
      modules = [ f.nixModules.gopls override ]; specialArgs = { inherit pkgs; };
    }).config.quantile.gopls.package.out;
  in [ (pkg {}) (pkg { quantile.gopls.package = pkgs.hello; }) ]`;
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
  const overridePath = outputs.find((path) =>
    existsSync(join(path, "bin/hello")),
  );
  const defaultPath = outputs.find((path) => path !== overridePath);
  if (!defaultPath || !overridePath) throw new Error(built.stdout);
  const run = (path: string, binary: string, args: string[]) => {
    const result = spawnSync(`${path}/bin/${binary}`, args, {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    return result.stdout + result.stderr;
  };
  expect(run(defaultPath, "gopls", ["version"])).toMatch(/gopls v?\d+/);
  expect(run(overridePath, "hello", [])).toContain("Hello, world!");
}, 180_000);
