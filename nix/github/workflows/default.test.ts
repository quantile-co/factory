import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("materializes protected native workflows without callable references", () => {
  for (const name of ["check", "test", "plan", "apply"]) {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${name}.yaml`, import.meta.url),
      "utf8",
    );
    const template = readFileSync(
      new URL(`../../../etc/github/workflows/${name}.yaml`, import.meta.url),
      "utf8",
    );
    expect(source).toBe(template);
    expect(source).not.toMatch(/^ {2}workflow_call:/m);
    expect(source).toContain("  NIX_CONFIG: |\n    require-sigs = true\n");
    expect(source).not.toContain("extra_nix_config:");
  }
  for (const name of ["plan", "apply"]) {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${name}.yaml`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("github.event_name == 'workflow_dispatch' &&");
    expect(source).toContain("github.ref == 'refs/heads/main' &&");
    expect(source).toContain("github.triggering_actor");
    expect(source).toContain("environment: prod");
    expect(source).not.toContain("actions/upload-artifact@");
  }
});

it("CI-only scripts transfer reviewed saved bytes and keep provider logs private", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-workflow-gcs-"));
  try {
    const factory = `git+${new URL("../../../", import.meta.url).href}`;
    const expr = `let
      f = builtins.getFlake ${JSON.stringify(factory)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      config = (pkgs.lib.evalModules {
        specialArgs = { inherit pkgs; };
        modules = [ f.nixModules.github-workflows f.nixModules.opentofu ({ lib, ... }: {
          config.quantile.opentofu.package = pkgs.writeShellScriptBin "tofu" ''
            set -euo pipefail
            printf '%s\\n' "$*" >> "$FAKE_TOFU_CALLS"
            echo provider-private-diagnostic
            if [[ " $* " == *" init "* ]]; then
              [[ " $* " == *" -backend-config=bucket=private-bucket "* ]]
              [[ " $* " == *" -backend-config=prefix=repository/prod "* ]]
            elif [[ " $* " == *" plan "* ]]; then
              if [ "''\${FAKE_FAIL_PLAN:-0}" = 1 ]; then exit 7; fi
              for arg in "$@"; do
                case "$arg" in -out=*) printf 'reviewed saved bytes' > "''\${arg#-out=}" ;; esac
              done
            elif [[ " $* " == *" apply "* ]]; then
              [[ " $* " != *" plan "* ]]
              [ "$(cat "''\${@: -1}")" = 'reviewed saved bytes' ]
              if [ "''\${FAKE_FAIL_APPLY:-0}" = 1 ]; then exit 9; fi
              echo applied > "$FAKE_APPLIED"
            else
              exit 81
            fi
          '';
          options.quantile.gcloud.package = lib.mkOption {
            type = lib.types.package;
            default = pkgs.writeShellApplication {
              name = "gcloud";
              runtimeInputs = [ pkgs.coreutils ];
              text = ''
                printf '%s\\n' "$*" >> "$FAKE_GCLOUD_CALLS"
                mkdir -p "$FAKE_STORAGE"
                if [ "$1 $2 $3" = 'storage cp --recursive' ]; then
                  mkdir -p "$FAKE_STORAGE/saved-plan"
                  cp "$4/plan.tfplan" "$FAKE_STORAGE/saved-plan/plan.tfplan"
                  cp "$4/plan.log" "$FAKE_STORAGE/saved-plan/plan.log"
                elif [ "$1 $2 $3" = 'storage objects describe' ]; then
                  printf '42\\n'
                elif [ "$1 $2" = 'storage cp' ] && [[ "$3" == *'#42' ]]; then
                  cp "$FAKE_STORAGE/saved-plan/plan.tfplan" "$4"
                elif [ "$1 $2" = 'storage cp' ]; then
                  cp "$3" "$FAKE_STORAGE/''\${3##*/}"
                else
                  exit 80
                fi
              '';
            };
          };
        }) ];
      }).config;
    in pkgs.symlinkJoin {
      name = "factory-workflow-gcs-test";
      paths = [ config.quantile.github.workflows.plan.package config.quantile.github.workflows.apply.package ];
    }`;
    const build = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", "--impure", "--expr", expr],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (build.error) throw build.error;
    expect(build.status, build.stderr).toBe(0);
    const bin = join(build.stdout.trim(), "bin");
    const planFile = join(root, "saved-plan", "plan.tfplan");
    const env = {
      ...process.env,
      GCP_TF_STATE_BUCKET: "private-bucket",
      GITHUB_REPOSITORY_ID: "123",
      GITHUB_RUN_ID: "456",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      RUNNER_TEMP: root,
      TF_BACKEND_PREFIX: "repository/prod",
      FAKE_STORAGE: join(root, "storage"),
      FAKE_GCLOUD_CALLS: join(root, "gcloud-calls"),
      FAKE_TOFU_CALLS: join(root, "tofu-calls"),
      FAKE_APPLIED: join(root, "applied"),
    };
    const invoke = (phase: "plan" | "apply", extra: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(join(bin, `github-workflow-${phase}`), [], {
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 20_000,
      });
      if (result.error) throw result.error;
      expect(result.stdout + result.stderr).not.toContain(
        "provider-private-diagnostic",
      );
      return result;
    };
    expect(invoke("plan", { FAKE_FAIL_PLAN: "1" }).status).toBe(7);
    expect(readFileSync(join(env.FAKE_STORAGE, "plan.log"), "utf8")).toContain(
      "provider-private-diagnostic",
    );
    expect(existsSync(planFile)).toBe(false);

    const planned = invoke("plan");
    expect(planned.status, planned.stderr).toBe(0);
    expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain("456/1/42");
    expect(
      readFileSync(join(env.FAKE_STORAGE, "saved-plan/plan.tfplan"), "utf8"),
    ).toBe("reviewed saved bytes");
    expect(existsSync(planFile)).toBe(false);

    const callsBeforeInvalid = readFileSync(env.FAKE_GCLOUD_CALLS, "utf8");
    expect(invoke("apply", { PLAN_REF: "bad" }).status).not.toBe(0);
    expect(readFileSync(env.FAKE_GCLOUD_CALLS, "utf8")).toBe(
      callsBeforeInvalid,
    );
    expect(
      invoke("apply", { PLAN_REF: "456/1/42", FAKE_FAIL_APPLY: "1" }).status,
    ).toBe(9);
    expect(readFileSync(join(env.FAKE_STORAGE, "apply.log"), "utf8")).toContain(
      "provider-private-diagnostic",
    );
    expect(existsSync(planFile)).toBe(false);
    expect(existsSync(env.FAKE_APPLIED)).toBe(false);

    const applied = invoke("apply", { PLAN_REF: "456/1/42" });
    expect(applied.status, applied.stderr).toBe(0);
    expect(existsSync(env.FAKE_APPLIED)).toBe(true);
    expect(existsSync(planFile)).toBe(false);
    expect(readFileSync(env.FAKE_GCLOUD_CALLS, "utf8")).toContain(
      "plan.tfplan#42",
    );
    const tofuCalls = readFileSync(env.FAKE_TOFU_CALLS, "utf8");
    expect(tofuCalls.match(/ plan /g)).toHaveLength(2);
    expect(tofuCalls.match(/ apply /g)).toHaveLength(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 150_000);
