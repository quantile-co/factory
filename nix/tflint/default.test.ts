import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("lints the selected root with consumer-native TFLint rules without changing source", () => {
  const root = new URL("../../", import.meta.url);
  const work = mkdtempSync(join(tmpdir(), "factory-tflint-"));
  try {
    const expr = `let f = builtins.getFlake ${JSON.stringify(`git+${root.href}`)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    in (pkgs.lib.evalModules { modules = [ f.nixModules.tflint ]; specialArgs = { inherit pkgs; }; }).config.quantile.tflint.check.package`;
    const built = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if (built.error) throw built.error;
    expect(built.status, built.stderr).toBe(0);
    const check = join(built.stdout.trim(), "bin/check-tflint");
    const project = join(work, "root with spaces");
    mkdirSync(project);
    const config = join(work, ".tflint.hcl");
    copyFileSync(
      new URL("../../etc/tflint/.tflint.hcl", import.meta.url),
      config,
    );
    const source = join(project, "main.tf");
    const invalid =
      'terraform { required_version = ">= 1.5.0" }\noutput "value" { value = "example" }\n';
    writeFileSync(source, invalid);
    const run = (env: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(check, [], {
        cwd: work,
        env: { ...process.env, TF_DIR: project, ...env },
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    };
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.output).toContain("terraform_documented_outputs");
    expect(readFileSync(source, "utf8")).toBe(invalid);
    const override = join(work, "alternate.tflint.hcl");
    writeFileSync(
      override,
      readFileSync(config, "utf8").replace(
        'rule "terraform_documented_outputs" { enabled = true }',
        'rule "terraform_documented_outputs" { enabled = false }',
      ),
    );
    expect(run({ TFLINT_CONFIG_FILE: "alternate.tflint.hcl" }).status).toBe(0);
    writeFileSync(
      source,
      'terraform { required_version = ">= 1.5.0" }\noutput "value" {\n  description = "Example output"\n  value       = "example"\n}\n',
    );
    const accepted = run();
    expect(accepted.status, accepted.output).toBe(0);
    rmSync(config);
    expect(run().output).toContain("requires consumer-native .tflint.hcl");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
