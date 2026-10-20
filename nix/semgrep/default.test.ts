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
    // Native policy excludes generated trees without relying on a Gitignore file.
    for (const generated of [
      "result",
      "result-cache",
      "nested/result-build",
      ".terraform",
      "nested/.terraform",
    ]) {
      const output = join(work, generated);
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "ignored.tf"), original);
    }
    const ignoredBuildOutputs = run(check);
    expect(ignoredBuildOutputs.status, ignoredBuildOutputs.output).toBe(0);
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
    const goRoot = join(work, "selected-go");
    mkdirSync(join(goRoot, "mocks"), { recursive: true });
    const goFixture = readFileSync(
      join(work, ".semgrep/go/error-wrap-wording.go"),
      "utf8",
    );
    const goSource = join(goRoot, "source.go");
    writeFileSync(goSource, goFixture);
    const goFinding = run(check, {}, ["selected-go"]);
    expect(goFinding.status).not.toBe(0);
    expect(goFinding.output).toContain("go-error-wrap-wording");
    expect(goFinding.output).toContain("source.go");
    rmSync(goSource);
    for (const generated of [
      "mocks/mock.go",
      "generated.pb.go",
      "generated.sql.go",
      "view_templ.go",
      "value_gen.go",
    ]) {
      writeFileSync(join(goRoot, generated), goFixture);
    }
    const ignoredGo = run(check, {}, ["selected-go"]);
    expect(ignoredGo.status, ignoredGo.output).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);

it("scans with pinned packs and local rules together", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-semgrep-packs-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [ f.nixModules.semgrep ({ config, ... }: {
        quantile.semgrep.check.configs = builtins.attrValues config.quantile.semgrep.packs;
      }) ];
    }).config.quantile.semgrep.check.package`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const check = join(built.stdout.trim(), "bin/check-semgrep");
    const scan = () =>
      spawnSync(check, ["sample.py", "sample.tf"], {
        cwd: work,
        env: {
          ...process.env,
          SEMGREP_RULES_DIR: fileURLToPath(new URL("etc/semgrep/rules", root)),
        },
        encoding: "utf8",
        timeout: 120_000,
      });
    writeFileSync(
      join(work, "sample.py"),
      "import yaml\nvalue = yaml.unsafe_load(raw)\n",
    );
    writeFileSync(
      join(work, "sample.tf"),
      'variable "password" {\n  type = string\n  sensitive = true\n}\n',
    );
    const bad = scan();
    if (bad.error) throw bad.error;
    expect(bad.status, bad.stdout + bad.stderr).toBe(1);
    expect(bad.stdout).toContain("avoid-pyyaml-load");
    expect(bad.stdout).toContain("terraform-sensitive-input-must-be-ephemeral");
    writeFileSync(
      join(work, "sample.py"),
      "import yaml\nvalue = yaml.safe_load(raw)\n",
    );
    writeFileSync(
      join(work, "sample.tf"),
      'variable "password" {\n  type = string\n  sensitive = true\n  ephemeral = true\n}\n',
    );
    const good = scan();
    if (good.error) throw good.error;
    expect(good.status, good.stdout + good.stderr).toBe(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 150_000);
