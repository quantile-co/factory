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

function namespaceWorkflows(
  otel = false,
  hindsight = false,
  actionRef: string | null = null,
): Record<string, string> {
  return JSON.parse(
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
              nixCache = "namespace";
              hindsight = ${hindsight ? "true" : "false"};
              otelJobs = ${otel ? '[ "test" "build" "plan" "apply" ]' : "[ ]"};
              otelActionRef = ${actionRef ? JSON.stringify(actionRef) : "null"};
          }; }
        ];
      }).config.quantile-co.factory.github.workflows;
    in builtins.mapAttrs (name: _: builtins.readFile workflows.\${name}.configFile) {
      check = null; test = null; build = null; plan = null; apply = null;
    }`,
      ],
      { encoding: "utf8" },
    ),
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

it("keeps Namespace lifecycle inside trusted GitHub task commands and leaves Check unchanged", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-namespace-workflow-"));
  try {
    const files = namespaceWorkflows();
    for (const [name, source] of Object.entries(files)) {
      const path = join(temporary, `${name}.yaml`);
      expect(source).not.toMatch(/[ \t]+\n/);
      writeFileSync(path, source as string);
      const data = workflow(path);
      for (const job of Object.values(data.jobs) as Array<{
        if: string;
        steps: Array<{
          name: string;
          if?: string;
          env?: Record<string, string>;
          run?: string;
        }>;
      }>) {
        const tasks = job.steps.filter(
          (step) => step.env?.NIX_CACHE_PROVIDER === "namespace",
        );
        if (name === "check") {
          expect(tasks).toHaveLength(0);
          expect(source).not.toContain("NIX_CACHE_PRIVATE_KEY");
          continue;
        }
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(source).not.toContain("cachix/cachix-action@");
        expect(tasks).toHaveLength(1);
        expect(tasks[0].env?.NIX_CACHE_PUBLIC_KEY).toBe(
          `\${{ vars.NIX_CACHE_PUBLIC_KEY }}`,
        );
        expect(tasks[0].env?.NIX_CACHE_PRIVATE_KEY).toBe(
          `\${{ secrets.NIX_CACHE_PRIVATE_KEY }}`,
        );
        expect(tasks[0].run).toContain(
          'env -u NIX_CACHE_PRIVATE_KEY "$direnv" exec . pnpm install --frozen-lockfile',
        );
        expect(tasks[0].run).toContain(`pnpm run github:${name}`);
        expect(
          job.steps.filter((step) => step.env?.NIX_CACHE_PRIVATE_KEY),
        ).toHaveLength(1);
        expect(
          job.steps.some((step) => step.name === "Publish Namespace Nix cache"),
        ).toBe(false);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("requires a published action ref instead of falling back to a task wrapper", () => {
  expect(() => namespaceWorkflows(true)).toThrow(
    "Set otelActionRef to a published Factory commit",
  );
});

it("starts the pinned native action first and confines ingestion credentials to it", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "factory-otel-action-workflow-"),
  );
  try {
    const ref = "a".repeat(40);
    const files = namespaceWorkflows(true, false, ref);
    expect(files.check).toBe(namespaceWorkflows().check);
    for (const name of ["test", "build", "plan", "apply"]) {
      const path = join(temporary, `${name}.yaml`);
      writeFileSync(path, files[name]);
      expect(files[name]).not.toContain("pnpm otel");
      for (const job of Object.values(workflow(path).jobs) as Array<{
        if: string;
        environment: string;
        steps: Array<{ uses?: string; env?: Record<string, string> }>;
      }>) {
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
        expect(job.environment).toBe("prod");
        expect(job.steps[0].uses).toBe(
          `quantile-co/factory/.github/actions/otel@${ref}`,
        );
        expect(job.steps[0].env?.CLICKSTACK_API_KEY).toBe(
          `\${{ secrets.CLICKSTACK_API_KEY }}`,
        );
        expect(
          job.steps.slice(1).every((step) => !step.env?.CLICKSTACK_API_KEY),
        ).toBe(true);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("selects Hindsight credentials only for protected Plan/Apply jobs", () => {
  const temporary = mkdtempSync(join(tmpdir(), "factory-hindsight-workflow-"));
  try {
    const ref = "a".repeat(40);
    const disabled = namespaceWorkflows(true, false, ref);
    const enabled = namespaceWorkflows(true, true, ref);
    for (const [name, source] of Object.entries(enabled)) {
      expect(disabled[name]).not.toContain("HINDSIGHT_API_TOKEN");
      if (!["plan", "apply"].includes(name)) {
        expect(source).toBe(disabled[name]);
        continue;
      }
      const path = join(temporary, `${name}.yaml`);
      writeFileSync(path, source);
      for (const job of Object.values(workflow(path).jobs) as Array<{
        if: string;
        environment: string;
        steps: Array<{ env?: Record<string, string> }>;
      }>) {
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
        expect(job.environment).toBe("prod");
        const tasks = job.steps.filter((step) => step.env?.HINDSIGHT_API_TOKEN);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].env?.HINDSIGHT_API_TOKEN).toBe(
          `\${{ secrets.HINDSIGHT_API_TOKEN }}`,
        );
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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

it("keeps protected deployment gates and signed Nix substitutions", () => {
  for (const directory of [".github/workflows", "etc/github/workflows"]) {
    for (const name of ["check", "test", "build", "plan", "apply"]) {
      const data = workflow(join(root, directory, `${name}.yaml`));
      for (const layer of Object.keys(data.jobs)) {
        const job = data.jobs[layer];
        const installer = job.steps.find((step: { uses?: string }) =>
          step.uses?.startsWith("cachix/install-nix-action@"),
        );
        expect(installer.with.extra_nix_config).toContain(
          "require-sigs = true",
        );
        if (!["build", "plan", "apply"].includes(name)) continue;
        expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(job.environment).toBe("prod");
        expect(data.concurrency["cancel-in-progress"]).toBe(false);
        expect(
          job.steps.some((step: { uses?: string }) =>
            step.uses?.startsWith("actions/upload-artifact@"),
          ),
        ).toBe(false);
      }
    }
  }
});
