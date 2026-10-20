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

it("checks Go formatting without mutation and fixes selected tracked files", () => {
  const root = new URL("../../", import.meta.url);
  const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
    pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    cfg = (pkgs.lib.evalModules {
      modules = [ f.nixModules.gofumpt ]; specialArgs = { inherit pkgs; };
    }).config.quantile.gofumpt;
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
  const formatterPath = outputs.find((path) =>
    existsSync(join(path, "bin/gofumpt")),
  );
  const checkPath = outputs.find((path) =>
    existsSync(join(path, "bin/check-gofumpt")),
  );
  const fixPath = outputs.find((path) =>
    existsSync(join(path, "bin/fix-gofumpt")),
  );
  if (!formatterPath || !checkPath || !fixPath) throw new Error(built.stdout);
  const temp = mkdtempSync(join(tmpdir(), "factory-gofumpt-"));
  const work = join(temp, "repo");
  const bad = "package fixture\nfunc Answer()int{return 42}\n";
  try {
    mkdirSync(work);
    const run = (command: string, args: string[] = [], env = {}) => {
      const result = spawnSync(command, args, {
        cwd: work,
        env: { ...process.env, ...env },
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
    const untracked = join(work, "untracked.go");
    const generated = join(work, "code.gen.go");
    const external = join(temp, "outside.go");
    writeFileSync(tracked, bad);
    writeFileSync(generated, bad);
    writeFileSync(external, bad);
    symlinkSync(external, join(work, "linked.go"));
    expect(
      run("git", ["add", "tracked.go", "code.gen.go", "linked.go"]).status,
    ).toBe(0);
    writeFileSync(untracked, bad);
    const check = `${checkPath}/bin/check-gofumpt`;
    const fix = `${fixPath}/bin/fix-gofumpt`;
    expect(run(check).output).toContain("Go formatting differs");
    expect(readFileSync(tracked, "utf8")).toBe(bad);
    expect(run(fix).status).toBe(0);
    expect(readFileSync(tracked, "utf8")).toContain(
      "func Answer() int { return 42 }",
    );
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(generated, "utf8")).toBe(bad);
    expect(readFileSync(external, "utf8")).toBe(bad);
    expect(run(check).output).toContain("untracked.go");
    expect(run(check, ["tracked.go"]).status).toBe(0);
    expect(run(check, [], { GOFUMPT_EXTRA: "invalid" }).status).toBe(2);
    expect(run(check, ["missing/**/*.go"]).status).not.toBe(0);
    const direct = run(`${formatterPath}/bin/gofumpt`, ["-l", tracked]);
    expect(direct.status).toBe(0);
    expect(direct.output).toBe("");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 180_000);
