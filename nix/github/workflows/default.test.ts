import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
function workflow(path: string) {
  return JSON.parse(
    execFileSync("yq", ["--output-format=json", ".", path], {
      encoding: "utf8",
    }),
  );
}

it("renders selected workflows as readable data without building for the target platform", () => {
  const files = JSON.parse(
    execFileSync(
      "nix",
      [
        "eval",
        "--impure",
        "--json",
        "--option",
        "allow-import-from-derivation",
        "false",
        "--expr",
        `let
      flake = builtins.getFlake ${JSON.stringify(`git+file://${root}`)};
      pkgs = import flake.inputs.nixpkgs { system = "aarch64-linux"; };
      workflows = (pkgs.lib.evalModules {
        specialArgs = { inherit pkgs; };
        modules = [
          ${root}/nix/github/workflows
          { quantile-co.factory.github.workflows = {
              layers = [ "infrastructure" ];
              build.layers = [ "application" ];
          }; }
        ];
      }).config.quantile-co.factory.github.workflows;
    in builtins.mapAttrs (_: phase: builtins.readFile workflows.\${phase}.configFile) {
      build = "build"; plan = "plan"; apply = "apply";
    }`,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(files.build).toContain("\n  application:\n");
  expect(files.build).not.toContain("\n  infrastructure:\n");
  expect(files.plan).toContain("\n  infrastructure:\n");
  expect(files.plan).not.toContain("\n  application:\n");
  expect(files.apply).toContain("--gh-plan-ref");
});

it("runs layer-specific workflow tasks at the repository root and forwards failures", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-workflow-task-"));
  try {
    const bin = join(temporary, "bin");
    mkdirSync(bin);
    const resultFile = join(temporary, "result.json");
    const executable = (name: string, code: string) => {
      const path = join(bin, name);
      writeFileSync(path, code);
      chmodSync(path, 0o755);
    };
    executable(
      "node",
      `#!${process.execPath}
const args = process.argv.slice(2);
const entry = args.indexOf("apps/github/cli.ts");
if (entry !== -1) {
  require("node:fs").writeFileSync(process.env.TEST_WORKFLOW_RESULT, JSON.stringify({
    cwd: process.cwd(), args: args.slice(entry + 1),
    cache: args[entry + 1] === "build" ? process.env.TURBO_CACHE : null
  }));
  process.exit(Number(process.env.TEST_WORKFLOW_EXIT));
}
const result = require("node:child_process").spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    );
    executable(
      "nix",
      `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(temporary)}\n`,
    );
    executable(
      "direnv",
      '#!/bin/sh\nif [ "$1" = allow ]; then exit 0; fi\nshift 2\nexec "$@"\n',
    );
    const pnpm = execFileSync("bash", ["-c", "command -v pnpm"], {
      encoding: "utf8",
    }).trim();
    executable(
      "pnpm",
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "install") {
  if (args.length !== 2 || args[1] !== "--frozen-lockfile") process.exit(81);
  process.exit(Number(process.env.TEST_INSTALL_EXIT));
}
const result = require("node:child_process").spawnSync(${JSON.stringify(pnpm)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    );
    const sentinel = join(temporary, "must-not-exist");
    const planReference = `'"; $(touch ${sentinel})`;
    for (const [phase, code] of [
      ["build", 0],
      ["plan", 0],
      ["apply", 23],
    ] as const) {
      const data = workflow(
        join(root, "etc/github/workflows", `${phase}.yaml`),
      );
      for (const layer of ["infrastructure", "application"]) {
        const step = data.jobs[layer].steps.at(-1);
        expect(Object.keys(step.env ?? {})).toEqual(
          phase === "build"
            ? ["TURBO_TOKEN"]
            : ["GH_REPO_TOKEN", ...(phase === "apply" ? ["GH_PLAN_REF"] : [])],
        );
        if (phase === "apply")
          expect(step.env.GH_PLAN_REF).toBe(`\${{ inputs.gh_plan_ref }}`);
        const script = step.run
          .replace(`\${{ vars.GCP_TF_STATE_BUCKET }}`, "private-bucket")
          .replace(`\${{ vars.GCP_WIF_POOL }}`, "approved-pool");
        const execute = (installExit = 0, token = "") =>
          spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              GH_REPO_TOKEN: "fixture-credential",
              TURBO_TOKEN: token,
              GH_PLAN_REF: planReference,
              TEST_WORKFLOW_RESULT: resultFile,
              TEST_WORKFLOW_EXIT: String(code),
              TEST_INSTALL_EXIT: String(installExit),
              pnpm_config_offline: "true",
            },
          });
        const run = execute();
        expect(run.status, run.stderr + run.stdout).toBe(code);
        expect(JSON.parse(readFileSync(resultFile, "utf8"))).toEqual({
          cwd: root,
          cache: phase === "build" ? "local:rw" : null,
          args: [
            phase,
            "--tf-layer",
            layer,
            ...(phase === "build"
              ? []
              : [
                  "--gcp-tf-state-bucket",
                  "private-bucket",
                  "--gcp-wif-pool",
                  "approved-pool",
                ]),
            ...(phase === "apply" ? ["--gh-plan-ref", planReference] : []),
          ],
        });
        expect(existsSync(sentinel)).toBe(false);
        if (phase === "build" && layer === "infrastructure") {
          const writer = execute(0, "writer-fixture");
          expect(writer.status, writer.stderr + writer.stdout).toBe(0);
          expect(JSON.parse(readFileSync(resultFile, "utf8")).cache).toBe(
            "local:rw,remote:rw",
          );
          rmSync(resultFile);
          const failed = execute(17);
          expect(failed.status, failed.stderr + failed.stdout).toBe(17);
          expect(existsSync(resultFile)).toBe(false);
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("offers selected artifact and deployment layers with inline installation and no owner rosters", () => {
  const envrc = readFileSync(join(root, ".envrc"), "utf8");
  expect(envrc).toContain(
    "extra-substituters = https://quantile-co.cachix.org",
  );
  expect(envrc).toContain("https://pre-commit-hooks.cachix.org");
  expect(envrc).toContain("extra-trusted-public-keys = ");
  for (const directory of [".github/workflows", "etc/github/workflows"]) {
    for (const name of ["check", "test", "build", "plan", "apply"]) {
      const path = join(root, directory, `${name}.yaml`);
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/^ {2}workflow_call:/m);
      expect(source).toMatch(
        /"\$direnv" exec \. pnpm install --frozen-lockfile\n\s*"\$direnv" exec \. pnpm (?:run |test)/,
      );
      expect(source).not.toMatch(
        /--tf-(directory|backend-prefix)|tf\/(application|infrastructure)|application\/prod/,
      );
      expect(source).not.toContain("extra-substituters = ");
      expect(source).toContain("extra_nix_config: require-sigs = true");
      expect(source).toContain(
        "nix build --no-link --print-out-paths '.#direnv'",
      );
      expect(source).toContain('"$direnv" allow .');
      if (name !== "build" && name !== "plan" && name !== "apply") continue;
      const data = workflow(path);
      const layers =
        directory === ".github/workflows"
          ? [name === "build" ? "application" : "infrastructure"]
          : ["infrastructure", "application"];
      expect(Object.keys(data.jobs)).toEqual(layers);
      expect(data.on.workflow_dispatch.inputs.tf_layer.options).toEqual(layers);
      expect(data.on.workflow_dispatch.inputs.tf_layer.default).toBe(layers[0]);
      for (const layer of layers) {
        const job = data.jobs[layer];
        expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(job.if).toContain(`inputs.tf_layer == '${layer}'`);
        expect(job.environment).toBe("prod");
        expect(job.steps.at(-1).run).toContain(`--tf-layer ${layer}`);
      }
      expect(source).not.toMatch(
        /PROJECT_OWNERS|PROJECT_MEMBERS|triggering_actor|FACTORY_|REST_API_BEARER:|GITHUB_TOKEN:/,
      );
      expect(source).not.toMatch(
        /^\s+(GCP_TF_STATE_BUCKET|GCP_WIF_POOL|TF_VAR_\w+):/m,
      );
      expect(source).toContain(`"$direnv" exec . pnpm run github:${name}`);
      expect(data.concurrency["cancel-in-progress"]).toBe(false);
      if (name === "build") {
        expect(source).not.toMatch(/GCP_TF_STATE_BUCKET|GCP_WIF_POOL|npm:/);
        continue;
      }
      expect(source).toContain(
        `--gcp-tf-state-bucket '\${{ vars.GCP_TF_STATE_BUCKET }}'`,
      );
      expect(source).toContain(`--gcp-wif-pool '\${{ vars.GCP_WIF_POOL }}'`);
      expect(source).not.toContain("github:build");
      expect(source).not.toContain("actions/upload-artifact@");
      if (name === "apply") {
        expect(source).toContain('--gh-plan-ref "$GH_PLAN_REF"');
      }
    }
  }
});
