{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile.github.workflows = {
    check.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../../etc/github/workflows/check.yaml;
      description = "Check workflow.";
    };
    test.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../../etc/github/workflows/test.yaml;
      description = "Test workflow.";
    };
    build.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../../etc/github/workflows/build.yaml;
      description = "Build workflow.";
    };
    plan = {
      configFile = lib.mkOption {
        type = lib.types.path;
        default = ../../../etc/github/workflows/plan.yaml;
        description = "Plan workflow.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "github-workflow-plan";
          runtimeInputs = [
            config.quantile.gcloud.package
            pkgs.coreutils
          ];
          text = ''
            : "''${GCP_TF_STATE_BUCKET:?Set the private state bucket}"
            : "''${GITHUB_REPOSITORY_ID:?Set the producing repository ID}"
            : "''${GITHUB_RUN_ID:?Set the producing run ID}"
            : "''${GITHUB_RUN_ATTEMPT:?Set the producing attempt}"
            : "''${GITHUB_STEP_SUMMARY:?Set the protected step summary path}"
            : "''${RUNNER_TEMP:?Set the runner scratch directory}"
            : "''${TF_PLAN_FILE:?Set the local plan output path}"
            cli="''${1:?Pass the pinned Devenv CLI path}"
            task="''${2:?Pass the consumer Plan task name}"
            private="$RUNNER_TEMP/saved-plan"
            test "$TF_PLAN_FILE" = "$private/plan.tfplan"
            base="gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT"
            umask 077
            mkdir -p -- "$private"

            cleanup() {
              status=$?
              trap - EXIT
              if (( status != 0 )) && [ -f "$private/plan.log" ]; then
                gcloud storage cp "$private/plan.log" "$base/plan.log" \
                  --if-generation-match=0 --quiet > /dev/null 2>&1 || :
              fi
              rm -rf -- "$private"
              exit "$status"
            }
            trap cleanup EXIT

            "$cli" tasks run --show-output "$task" > "$private/plan.log" 2>&1
            test -s "$TF_PLAN_FILE"
            gcloud storage cp --recursive "$private" "$base/" \
              --if-generation-match=0 --quiet > /dev/null
            generation=$(gcloud storage objects describe \
              "$base/saved-plan/plan.tfplan" --raw --format='value(generation)')
            [[ "$generation" =~ ^[1-9][0-9]*$ ]]
            printf 'Plan reference: %s/%s/%s\n' \
              "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$generation" >> "$GITHUB_STEP_SUMMARY"
          '';
        };
        description = "Plan.";
      };
    };
    apply = {
      configFile = lib.mkOption {
        type = lib.types.path;
        default = ../../../etc/github/workflows/apply.yaml;
        description = "Apply workflow.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "github-workflow-apply";
          runtimeInputs = [
            config.quantile.gcloud.package
            pkgs.coreutils
          ];
          text = ''
            : "''${GCP_TF_STATE_BUCKET:?Set the private state bucket}"
            : "''${GITHUB_REPOSITORY_ID:?Set the producing repository ID}"
            : "''${GITHUB_RUN_ID:?Set the Apply run ID}"
            : "''${GITHUB_RUN_ATTEMPT:?Set the Apply attempt}"
            : "''${RUNNER_TEMP:?Set the runner scratch directory}"
            : "''${TF_PLAN_FILE:?Set the local plan input path}"
            : "''${PLAN_REF:?Set the reviewed run/attempt/generation}"
            cli="''${1:?Pass the pinned Devenv CLI path}"
            task="''${2:?Pass the consumer Apply task name}"
            [[ "$PLAN_REF" =~ ^([1-9][0-9]*)/([1-9][0-9]*)/([1-9][0-9]*)$ ]]
            source="gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/''${BASH_REMATCH[1]}/''${BASH_REMATCH[2]}/saved-plan/plan.tfplan#''${BASH_REMATCH[3]}"
            private="$RUNNER_TEMP/saved-plan"
            test "$TF_PLAN_FILE" = "$private/plan.tfplan"
            umask 077
            mkdir -p -- "$private"
            test ! -e "$TF_PLAN_FILE"

            cleanup() {
              status=$?
              trap - EXIT
              if (( status != 0 )) && [ -f "$private/apply.log" ]; then
                gcloud storage cp "$private/apply.log" \
                  "gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/apply/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT/apply.log" \
                  --if-generation-match=0 --quiet > /dev/null 2>&1 || :
              fi
              rm -rf -- "$private"
              exit "$status"
            }
            trap cleanup EXIT

            gcloud storage cp "$source" "$TF_PLAN_FILE" --quiet > "$private/apply.log" 2>&1
            test -s "$TF_PLAN_FILE"
            "$cli" tasks run --show-output "$task" >> "$private/apply.log" 2>&1
          '';
        };
        description = "Apply plan.";
      };
    };
  };
}
