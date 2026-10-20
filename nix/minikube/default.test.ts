import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("exposes overridable Minikube without starting a cluster", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    pkg = override: (pkgs.lib.evalModules {
      modules = [ f.nixModules.minikube override ]; specialArgs = { inherit pkgs; };
    }).config.quantile.minikube.package.out;
  in [ (pkg {}) (pkg { quantile.minikube.package = pkgs.hello; }) ]`;
  const built = spawnSync(
    "nix",
    ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
    { encoding: "utf8", timeout: 150_000 },
  );
  if (built.error) throw built.error;
  expect(built.status, built.stderr).toBe(0);
  const paths = built.stdout.trim().split("\n");
  const replacement = paths.find((path) => existsSync(join(path, "bin/hello")));
  const selected = paths.find((path) => path !== replacement);
  if (!selected || !replacement) throw new Error(built.stdout);
  const home = mkdtempSync(join(tmpdir(), "factory-minikube-"));
  try {
    const result = spawnSync(join(selected, "bin/minikube"), ["version"], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        MINIKUBE_HOME: home,
        KUBECONFIG: "/dev/null",
      },
      encoding: "utf8",
      timeout: 20_000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/minikube version: v?\d+\.\d+/);
    expect(
      spawnSync(join(replacement, "bin/hello"), [], { encoding: "utf8" })
        .stdout,
    ).toContain("Hello, world!");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 180_000);
