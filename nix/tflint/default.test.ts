import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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
      cfg = (pkgs.lib.evalModules {
        modules = [ f.nixModules.tflint f.nixModules.opentofu ]; specialArgs = { inherit pkgs; };
      }).config.quantile-co.factory;
    in [ cfg.tflint.check.package cfg.opentofu.check.package ]`;
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
    const paths = built.stdout.trim().split("\n");
    const check = join(
      paths.find((path) => path.endsWith("-check-tflint")) ?? "",
      "bin/check-tflint",
    );
    const tofuCheck = join(
      paths.find((path) => path.endsWith("-check-terraform")) ?? "",
      "bin/check-terraform",
    );
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
    const run = (
      env: NodeJS.ProcessEnv = {},
      command = check,
      args: string[] = [],
    ) => {
      const result = spawnSync(command, args, {
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

    // A Git-sourced module requires isolated initialization before linting.
    const module = join(work, "module-source");
    mkdirSync(module);
    writeFileSync(join(module, "main.tf"), invalid);
    for (const args of [
      ["init", "-q"],
      ["add", "main.tf"],
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      ],
    ]) {
      const git = spawnSync("git", args, { cwd: module, encoding: "utf8" });
      expect(git.status, git.stderr).toBe(0);
    }
    const revision = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: module,
      encoding: "utf8",
    });
    expect(revision.status).toBe(0);
    writeFileSync(
      source,
      `terraform { required_version = ">= 1.5.0" }\nmodule "downloaded" { source = "git::https://example.invalid/fixture.git?ref=${revision.stdout.trim()}" }\noutput "value" { value = module.downloaded.value }\n`,
    );
    mkdirSync(join(project, ".terraform"));
    const production = join(project, ".terraform/terraform.tfstate");
    writeFileSync(
      production,
      "production backend metadata must remain untouched\n",
    );
    const ambient = {
      TF_DATA_DIR: join(project, ".terraform"),
      // Exercise a pinned Git source entirely offline without weakening lint rules.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.file://${module}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://example.invalid/fixture.git",
    };
    expect(run(ambient).status).not.toBe(0);
    // Both the explicit state directory and the Git-owned fallback must work.
    for (const state of [join(work, "isolated-data"), ""]) {
      const env = { ...ambient, QUANTILE_CO_FACTORY_STATE_DIR: state };
      const initialized = run(env, tofuCheck);
      expect(initialized.status, initialized.output).toBe(0);
      const linted = run(env);
      expect(linted.status).not.toBe(0);
      expect(linted.output).toContain("terraform_documented_outputs");
      const passed = run({ ...env, TFLINT_CONFIG_FILE: override });
      expect(passed.status, passed.output).toBe(0);
      expect(readFileSync(production, "utf8")).toBe(
        "production backend metadata must remain untouched\n",
      );
    }
    expect(existsSync(join(project, ".terraform/modules"))).toBe(false);
    const child = join(work, "companion-ran");
    writeFileSync(source, "invalid Terraform syntax\n");
    const rejectedCommand = run(
      { QUANTILE_CO_FACTORY_STATE_DIR: join(work, "isolated-data") },
      tofuCheck,
      ["--", "touch", child],
    );
    expect(rejectedCommand.status).toBe(2);
    expect(rejectedCommand.output).toContain("Usage: check-terraform");
    expect(existsSync(child)).toBe(false);
    rmSync(config);
    expect(run().output).toContain("requires consumer-native .tflint.hcl");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);
