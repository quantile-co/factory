import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("provides overridable gotools and formats Go on stdin without writing files", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    pkg = override: (pkgs.lib.evalModules {
      modules = [ f.nixModules.gotools override ]; specialArgs = { inherit pkgs; };
    }).config.quantile.gotools.package.out;
  in [ (pkg {}) (pkg { quantile.gotools.package = pkgs.hello; }) ]`;
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
  const formatted = spawnSync(`${defaultPath}/bin/goimports`, [], {
    input: "package example\nfunc Value()int{return 1}\n",
    encoding: "utf8",
    timeout: 20_000,
  });
  if (formatted.error) throw formatted.error;
  expect(formatted.status, formatted.stderr).toBe(0);
  expect(formatted.stdout).toContain("func Value() int { return 1 }");
  const hello = spawnSync(`${overridePath}/bin/hello`, [], {
    encoding: "utf8",
  });
  if (hello.error) throw hello.error;
  expect(hello.status, hello.stderr).toBe(0);
  expect(hello.stdout).toContain("Hello, world!");
}, 180_000);
