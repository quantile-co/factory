import { spawnSync } from "node:child_process";
import {
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

it("checks exact native Rego policies with explicit data and rejects empty or failing checks without editing source", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-opa-"));
  const repo = join(work, "consumer");
  try {
    mkdirSync(join(repo, "policy"), { recursive: true });
    mkdirSync(join(repo, "workload"));
    const files = {
      "policy/main.rego": `package main
import rego.v1
deny contains "version too low" if { input.version < data.settings.minimum_version }
`,
      "policy/main_test.rego": `package main
import rego.v1
test_accept if { count(deny) == 0 with input as {"version": 2} }
test_reject if { "version too low" in deny with input as {"version": 1} }
test_yaml_not_implicit_data if { not data.incidental_workflow }
`,
      "policy/unselected.rego": `package main
import rego.v1
deny contains "unselected policy loaded"
`,
      "policy/workflow.yaml": "incidental_workflow: true\n",
      "minimum.json": '{"settings":{"minimum_version":2}}\n',
      "workload/config with spaces.json": '{"version":2}\n',
    };
    for (const [file, source] of Object.entries(files)) {
      writeFileSync(join(repo, file), source);
    }
    const external = join(work, "external.json");
    writeFileSync(external, '{"version":0}\n');
    symlinkSync(external, join(repo, "workload/linked.json"));
    const run = (command: string, args: string[], cwd = repo) => {
      const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: result.stdout,
        output: result.stdout + result.stderr,
      };
    };
    expect(
      run("git", ["init", "--quiet", "--initial-branch=main"]).status,
    ).toBe(0);
    expect(run("git", ["add", "."]).status).toBe(0);
    const build = (tool: "opa" | "conftest", selector: string) => {
      const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
        pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      in (pkgs.lib.evalModules {
        modules = [ f.nixModules.${tool} ]; specialArgs = { inherit pkgs; };
      }).config.quantile-co.factory.${tool}.${selector}.package`;
      const built = run(
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
        work,
      );
      expect(built.status, built.output).toBe(0);
      return built.stdout.trim();
    };
    const check = join(build("conftest", "check"), "bin/check-opa");
    const test = join(build("opa", "test"), "bin/test-opa");
    writeFileSync(join(work, "outside.rego"), files["policy/main.rego"]);
    symlinkSync(join(work, "outside.rego"), join(repo, "policy/linked.rego"));
    for (const command of [check, test]) {
      const traversal = run(command, [
        "--policy",
        "policy",
        "--namespace",
        "main",
        "--policy-file",
        "../../outside.rego",
      ]);
      expect(traversal.status).not.toBe(0);
      expect(traversal.output).toContain("Rego policy escapes --policy");
      const linked = run(command, [
        "--policy",
        "policy",
        "--namespace",
        "main",
        "--policy-file",
        "linked.rego",
      ]);
      expect(linked.status).not.toBe(0);
      expect(linked.output).toContain("Missing or invalid Rego policy");
    }
    const args = [
      "--policy",
      "policy",
      "--namespace",
      "main",
      "--policy-file",
      "main.rego",
      "--policy-file",
      "main_test.rego",
      "--data",
      "minimum.json",
    ];
    const good = run(check, [...args, "--", "workload/*.json"]);
    expect(good.status, good.output).toBe(0);
    expect(good.output).toContain('"successes": 1');
    const tests = run(test, args);
    expect(tests.status, tests.output).toBe(0);
    expect(tests.output).toContain("PASS: 3/3");
    const unit = join(repo, "policy/main_test.rego");
    writeFileSync(
      unit,
      `${files["policy/main_test.rego"]}test_expected_failure if false\n`,
    );
    const failingUnit = run(test, args);
    expect(failingUnit.status).not.toBe(0);
    expect(failingUnit.output).toContain("test_expected_failure: FAIL");
    writeFileSync(unit, files["policy/main_test.rego"]);

    const wrongNamespace = run(check, [
      ...args.slice(0, 3),
      "absent",
      ...args.slice(4),
      "--",
      "workload/*.json",
    ]);
    expect(wrongNamespace.status).not.toBe(0);
    expect(wrongNamespace.output).toContain("No Conftest checks executed");
    const wrongTests = run(test, [
      ...args.slice(0, 3),
      "absent",
      ...args.slice(4),
    ]);
    expect(wrongTests.status).not.toBe(0);
    expect(wrongTests.output).toContain("no tests were run");
    const missing = run(check, [...args, "--", "missing/*.json"]);
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("No workload inputs selected");
    const noUnitTests = run(test, [
      "--policy",
      "policy",
      "--namespace",
      "main",
      "--policy-file",
      "main.rego",
      "--data",
      "minimum.json",
    ]);
    expect(noUnitTests.status).not.toBe(0);
    expect(noUnitTests.output).toContain("no tests were run");

    const bad = join(repo, "workload/bad with spaces.json");
    writeFileSync(bad, '{"version":1}\n');
    const rejected = run(check, [...args, "--", "workload/*.json"]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("version too low");
    expect(readFileSync(bad, "utf8")).toBe('{"version":1}\n');
    rmSync(bad);
    const unselected = run(check, [
      "--policy",
      "policy",
      "--namespace",
      "main",
      "--data",
      "minimum.json",
      "--",
      "workload/*.json",
    ]);
    expect(unselected.status).not.toBe(0);
    expect(unselected.output).toContain("unselected policy loaded");
    for (const [file, source] of Object.entries(files)) {
      expect(readFileSync(join(repo, file), "utf8")).toBe(source);
    }
    expect(readFileSync(external, "utf8")).toBe('{"version":0}\n');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
