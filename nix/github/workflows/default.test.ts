import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps protected local workflows on pinned direnv without callable references", () => {
  const envrc = readFileSync(
    new URL("../../../.envrc", import.meta.url),
    "utf8",
  );
  expect(envrc).toContain(
    "extra-substituters = https://quantile-co.cachix.org",
  );
  expect(envrc).toContain("https://pre-commit-hooks.cachix.org");
  expect(envrc).toContain("extra-trusted-public-keys = ");
  for (const name of ["check", "test", "plan", "apply"]) {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${name}.yaml`, import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/^ {2}workflow_call:/m);
    expect(source).not.toContain("extra-substituters = ");
    expect(source).toContain("extra_nix_config: require-sigs = true");
    expect(source).toContain(
      "nix build --no-link --print-out-paths '.#direnv'",
    );
    expect(source).toContain('"$direnv" allow .');
    expect(source).toContain(`"$direnv" exec . ./scripts/github/${name}.sh`);
  }
  expect(
    readFileSync(
      new URL("../../../etc/github/workflows/build.yaml", import.meta.url),
      "utf8",
    ),
  ).toContain('"$direnv" exec . ./scripts/github/build.sh');
  for (const name of ["plan", "apply"]) {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${name}.yaml`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("github.event_name == 'workflow_dispatch' &&");
    expect(source).toContain("github.ref == 'refs/heads/main' &&");
    for (const actor of ["github.actor", "github.triggering_actor"]) {
      expect(source).toContain(
        `contains(fromJSON(vars.PROJECT_OWNERS || '[]').*.gh_username, ${actor})`,
      );
    }
    expect(source).toContain(
      `TF_VAR_project_owners: \${{ vars.PROJECT_OWNERS }}`,
    );
    expect(source).toContain(
      `TF_VAR_project_members: \${{ vars.PROJECT_MEMBERS || '[]' }}`,
    );
    expect(source).not.toMatch(/GH_MAINTAINERS|GCP_MAINTAINERS/);
    expect(source).toContain(
      `GCP_TF_STATE_BUCKET: \${{ vars.GCP_TF_STATE_BUCKET }}`,
    );

    expect(source).toContain("environment: prod");
    expect(source).not.toContain("actions/upload-artifact@");
  }
});

it.each([undefined, "tf"])(
  "CI-only scripts preserve saved bytes and private logs with TF_DIR=%s",
  (tfDir) => {
    const root = mkdtempSync(join(tmpdir(), "factory-workflow-gcs-"));
    try {
      const factory = `git+${new URL("../../../", import.meta.url).href}`;
      const expr = `let
      f = builtins.getFlake ${JSON.stringify(factory)};
      pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      config = (pkgs.lib.evalModules {
        specialArgs.pkgs = pkgs // { google-cloud-sdk = config.testGcloud; };
        modules = [ f.nixModules.github f.nixModules.opentofu ({ lib, ... }: {
          config.quantile-co.factory.opentofu.package = pkgs.writeShellScriptBin "tofu" ''
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
          options.testGcloud = lib.mkOption {
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
      paths = [ config.quantile-co.factory.github.workflows.plan.package config.quantile-co.factory.github.workflows.apply.package ];
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
        TF_DIR: tfDir,
        FAKE_STORAGE: join(root, "storage"),
        FAKE_GCLOUD_CALLS: join(root, "gcloud-calls"),
        FAKE_TOFU_CALLS: join(root, "tofu-calls"),
        FAKE_APPLIED: join(root, "applied"),
      };
      const invoke = (
        phase: "plan" | "apply",
        extra: NodeJS.ProcessEnv = {},
        command: string[] = [],
      ) => {
        const result = spawnSync(
          join(bin, `github-workflow-${phase}`),
          command,
          {
            env: { ...env, ...extra },
            encoding: "utf8",
            timeout: 20_000,
          },
        );
        if (result.error) throw result.error;
        expect(result.stdout + result.stderr).not.toContain(
          "provider-private-diagnostic",
        );
        return result;
      };
      expect(invoke("plan", { FAKE_FAIL_PLAN: "1" }).status).toBe(7);
      expect(
        readFileSync(join(env.FAKE_STORAGE, "plan.log"), "utf8"),
      ).toContain("provider-private-diagnostic");
      expect(existsSync(planFile)).toBe(false);

      const planned = invoke("plan");
      expect(planned.status, planned.stderr).toBe(0);
      expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain(
        "456/1/42",
      );
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
      expect(
        readFileSync(join(env.FAKE_STORAGE, "apply.log"), "utf8"),
      ).toContain("provider-private-diagnostic");
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
      for (const call of tofuCalls.trim().split("\n")) {
        expect(call).toMatch(
          new RegExp(
            `^-chdir=${tfDir ?? "tf/infrastructure"} (init|plan|apply) `,
          ),
        );
      }

      // A caller-owned local task receives the same protected plan path. The
      // transport does not also invoke its default OpenTofu command.
      const custom = (phase: "plan" | "apply", fail = false) =>
        invoke(
          phase,
          {
            PLAN_REF: "456/1/42",
            TF_BACKEND_PREFIX: undefined,
          },
          [
            process.execPath,
            "-e",
            `
        const fs = require("node:fs");
        if (process.argv[1] !== "argument with spaces") process.exit(80);
        console.log("provider-private-diagnostic");
        if (${fail}) process.exit(11);
        const path = process.env.TF_PLAN_FILE;
        if (${JSON.stringify(phase)} === "plan") fs.writeFileSync(path, "reviewed saved bytes");
        else if (fs.readFileSync(path, "utf8") !== "reviewed saved bytes") process.exit(81);
      `,
            "argument with spaces",
          ],
        );
      expect(custom("plan", true).status).toBe(11);
      expect(existsSync(planFile)).toBe(false);
      expect(custom("plan").status).toBe(0);
      expect(custom("apply", true).status).toBe(11);
      expect(existsSync(planFile)).toBe(false);
      expect(custom("apply").status).toBe(0);
      expect(existsSync(planFile)).toBe(false);
      expect(readFileSync(env.FAKE_TOFU_CALLS, "utf8")).toBe(tofuCalls);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  150_000,
);
