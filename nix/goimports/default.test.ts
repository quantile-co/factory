import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("checks goimports output and fixes only tracked regular Go files", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = (pkgs.lib.evalModules {
      modules = [ f.nixModules.goimports ]; specialArgs = { inherit pkgs; };
    }).config.quantile-co.factory.goimports;
  in [ cfg.package.out cfg.check.package.out cfg.fix.package.out ]`;
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
  const packagePath = outputs.find((path) =>
    existsSync(join(path, "bin/goimports")),
  );
  const checkPath = outputs.find((path) =>
    existsSync(join(path, "bin/check-goimports")),
  );
  const fixPath = outputs.find((path) =>
    existsSync(join(path, "bin/fix-goimports")),
  );
  if (!packagePath || !checkPath || !fixPath) throw new Error(built.stdout);
  const temp = mkdtempSync(join(tmpdir(), "factory-goimports-"));
  const work = join(temp, "repo");
  const bad =
    'package fixture\n\nimport "fmt"\n\nfunc Answer()int{return 42}\n';
  try {
    mkdirSync(work);
    const run = (command: string, args: string[] = []) => {
      const result = spawnSync(command, args, {
        cwd: work,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    const tracked = join(work, "tracked.go");
    const generated = join(work, "code.gen.go");
    const untracked = join(work, "untracked.go");
    const external = join(temp, "outside.go");
    writeFileSync(tracked, bad);
    writeFileSync(generated, bad);
    writeFileSync(external, bad);
    symlinkSync(external, join(work, "linked.go"));
    expect(
      run("git", ["add", "tracked.go", "code.gen.go", "linked.go"]).status,
    ).toBe(0);
    writeFileSync(untracked, bad);
    const check = join(checkPath, "bin/check-goimports");
    const fix = join(fixPath, "bin/fix-goimports");
    expect(run(check).output).toContain("Go imports differ");
    expect(readFileSync(tracked, "utf8")).toBe(bad);
    expect(run(fix).status).toBe(0);
    expect(readFileSync(tracked, "utf8")).not.toContain('import "fmt"');
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(generated, "utf8")).toBe(bad);
    expect(readFileSync(external, "utf8")).toBe(bad);
    expect(run(check).output).toContain("untracked.go");
    expect(run(check, ["tracked.go"]).status).toBe(0);
    expect(run(check, ["missing/**/*.go"]).status).not.toBe(0);
    expect(
      run(join(packagePath, "bin/goimports"), ["-l", tracked]).status,
    ).toBe(0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 180_000);
