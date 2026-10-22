import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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

it("uses native EditorConfig for read-only checks and tracked-only shell fixes", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-shfmt-"));
  const repo = join(work, "consumer");
  try {
    mkdirSync(repo);
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.shfmt ]; specialArgs = { inherit pkgs; }; }).config.quantile-co.factory.shfmt;
    in [ cfg.check.package cfg.fix.package ]`;
    const build = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (build.error) throw build.error;
    expect(build.status, build.stderr).toBe(0);
    const paths = build.stdout.trim().split("\n");
    const check = join(
      paths.find((path) => path.endsWith("-check-shfmt")) ?? "",
      "bin/check-shfmt",
    );
    const fix = join(
      paths.find((path) => path.endsWith("-fix-shfmt")) ?? "",
      "bin/fix-shfmt",
    );
    const run = (bin: string, args: string[] = []) => {
      const result = spawnSync(bin, args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(run("git", ["init", "-q"]).status).toBe(0);
    const config = join(repo, ".editorconfig");
    copyFileSync(
      new URL("../../etc/editorconfig/.editorconfig", import.meta.url),
      config,
    );
    mkdirSync(join(repo, "scripts with spaces"));
    const source = join(repo, "scripts with spaces/format.sh");
    const bad = `#!/usr/bin/env bash
if [[ -n \${1:-} ]]; then
  printf '%s\\n' "$1"
fi
`;
    const formatted = bad.replace("\n  printf", "\n    printf");
    writeFileSync(source, bad);
    const untracked = join(repo, "untracked.sh");
    writeFileSync(untracked, bad);
    const outside = join(work, "outside.sh");
    writeFileSync(outside, bad);
    symlinkSync(outside, join(repo, "linked.sh"));
    expect(
      run("git", [
        "add",
        ".editorconfig",
        "scripts with spaces/format.sh",
        "linked.sh",
      ]).status,
    ).toBe(0);
    const rejected = run(check);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("format.sh");
    expect(readFileSync(source, "utf8")).toBe(bad);
    expect(run(fix).status).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(formatted);
    expect(readFileSync(untracked, "utf8")).toBe(bad);
    expect(readFileSync(outside, "utf8")).toBe(bad);
    expect(run(check, ["scripts with spaces"]).status).toBe(0);
    writeFileSync(join(repo, "runner"), bad);
    expect(run("git", ["add", "runner"]).status).toBe(0);
    const extensionless = run(check);
    expect(extensionless.status).not.toBe(0);
    expect(extensionless.output).toContain("runner");
    writeFileSync(
      config,
      readFileSync(config, "utf8").replaceAll(
        "indent_size = 4",
        "indent_size = 2",
      ),
    );
    const nativeOverride = run(check, ["scripts with spaces"]);
    expect(nativeOverride.status).not.toBe(0);
    expect(nativeOverride.output).toContain("format.sh");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
