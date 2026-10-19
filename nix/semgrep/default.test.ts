import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("tests selected Semgrep fixtures and scans source without modifying it", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-semgrep-consumer-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in let cfg = (pkgs.lib.evalModules { modules = [ f.nixModules.semgrep ]; specialArgs = { inherit pkgs; }; }).config.quantile.semgrep;
    in [ cfg.test.package cfg.check.package ]`;
    const built = spawnSync(
      "nix",
      [
        "--extra-experimental-features",
        "nix-command flakes",
        "build",
        "--no-link",
        "--print-out-paths",
        "--impure",
        "--expr",
        expr,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    cpSync(
      fileURLToPath(new URL("../../etc/semgrep/rules", import.meta.url)),
      join(work, ".semgrep"),
      { recursive: true },
    );
    copyFileSync(
      fileURLToPath(
        new URL("../../etc/semgrep/.semgrepignore", import.meta.url),
      ),
      join(work, ".semgrepignore"),
    );
    const packages = built.stdout.trim().split("\n");
    const testPackage = packages.find((path) => path.endsWith("-test-semgrep"));
    const checkPackage = packages.find((path) =>
      path.endsWith("-check-semgrep"),
    );
    if (!testPackage || !checkPackage) throw new Error(built.stdout);
    const run = (
      command: string,
      env: NodeJS.ProcessEnv = {},
      args: string[] = [],
    ) => {
      const result = spawnSync(command, args, {
        cwd: work,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const test = join(testPackage, "bin/test-semgrep");
    const check = join(checkPackage, "bin/check-semgrep");
    const tested = run(test);
    expect(tested.status, tested.output).toBe(0);
    expect(tested.output).toContain("Semgrep rule tests passed.");
    const ruleFixture = join(work, ".semgrep/tf/sensitive-inputs.tf");
    const annotated = readFileSync(ruleFixture, "utf8");
    writeFileSync(ruleFixture, annotated.replace("# ruleid:", "# ok:"));
    const failingTests = run(test);
    expect(failingTests.status).not.toBe(0);
    expect(failingTests.output).toContain("Semgrep rule tests failed.");
    writeFileSync(ruleFixture, annotated);
    const missingTests = join(work, "no-fixtures");
    mkdirSync(missingTests);
    const empty = run(test, { SEMGREP_TESTS_DIR: missingTests });
    expect(empty.status).not.toBe(0);
    expect(empty.output).toContain("No Semgrep rule tests selected.");
    const source = join(work, "bad.tf");
    const original =
      'variable "password" {\n  type = string\n  sensitive = true\n}\n';
    writeFileSync(source, original);
    const checked = run(check);
    expect(checked.status).not.toBe(0);
    expect(checked.output).toContain(
      "terraform-sensitive-input-must-be-ephemeral",
    );
    expect(checked.output).toContain("bad.tf");
    expect(readFileSync(source, "utf8")).toBe(original);
    writeFileSync(
      source,
      original.replace(
        "sensitive = true",
        "sensitive = true\n  ephemeral = true",
      ),
    );
    const clean = run(check);
    expect(clean.status, clean.output).toBe(0);
    const fixtures = join(work, "selected-fixtures");
    mkdirSync(join(fixtures, "tf"), { recursive: true });
    copyFileSync(
      join(work, ".semgrep/tf/sensitive-inputs.tf"),
      join(fixtures, "tf/sensitive-inputs.tf"),
    );
    const separate = run(test, { SEMGREP_TESTS_DIR: fixtures });
    expect(separate.status, separate.output).toBe(0);
    mkdirSync(join(work, "selected"));
    writeFileSync(join(work, "selected/good.tf"), readFileSync(source));
    writeFileSync(source, original);
    const scoped = run(check, {}, ["selected"]);
    expect(scoped.status, scoped.output).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
