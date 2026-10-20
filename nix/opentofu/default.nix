{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.opentofu;
  tofu = cfg.package;
  remoteInit = ''
    : "''${GCP_TF_STATE_BUCKET:?Missing state bucket}"
    : "''${TF_BACKEND_PREFIX:?Missing backend prefix}"
    tofu -chdir="$tf_dir" init -input=false -lockfile=readonly \
      -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
      -backend-config="prefix=$TF_BACKEND_PREFIX"
  '';
  tools = with pkgs; [
    coreutils
    gh
    git
    jq
    unzip
  ];
  setup = ''
    set +x
    umask 077
    : "''${TF_PLAN_DIR:?Set an absolute private working directory}"
    : "''${GCP_TF_STATE_BUCKET:?Missing state bucket}"
    : "''${TF_BACKEND_PREFIX:?Missing backend prefix}"
    case "$TF_PLAN_DIR" in /*) ;; *) echo "TF_PLAN_DIR must be absolute" >&2; exit 1 ;; esac
    mkdir -p "$TF_PLAN_DIR/private" "$TF_PLAN_DIR/artifact"
    export TF_PLAN_FILE="$TF_PLAN_DIR/private/plan.tfplan"
    backend=$(printf '%s\n%s\n' "$GCP_TF_STATE_BUCKET" "$TF_BACKEND_PREFIX" | sha256sum | cut -d ' ' -f1)
  '';
  privateBucket = ''
    gcloud storage buckets describe "gs://$GCP_TF_STATE_BUCKET" --raw --format=json |
      jq -e '.iamConfiguration.publicAccessPrevention == "enforced" and
        .iamConfiguration.uniformBucketLevelAccess.enabled == true' > /dev/null
  '';
  privateRepository = ''
    test "$(gh api "repos/$GITHUB_REPOSITORY" --jq .private)" = true
  '';
  # Plans can contain sensitive state. Private repositories can use GitHub artifacts;
  # public repositories use private GCS and publish only a hash/generation receipt.
  # Authorization stays in the workflow. These helpers handle storage and bind
  # the selected artifact to its successful producer, source and backend.
  savePlan =
    storage:
    pkgs.writeShellApplication {
      name = "plan-${storage}";
      runtimeInputs = tools ++ lib.optionals (storage == "gcs") [ pkgs.google-cloud-sdk ];
      text =
        setup
        + (if storage == "gcs" then privateBucket else privateRepository)
        + ''
          # Plans and their rendering may contain sensitive state; keep them out of public logs.
          ${lib.getExe cfg.plan.package} > "$TF_PLAN_DIR/private/plan.log" 2>&1 || {
            echo "Plan failed; no artifact was published." >&2
            exit 1
          }
          digest=$(sha256sum "$TF_PLAN_FILE" | cut -d ' ' -f1)
          generation=""
        ''
        + (
          if storage == "gcs" then
            ''
              # Public repositories upload only a receipt to Actions. A create-only upload
              # and a pinned GCS generation prevent silently replacing the saved plan.
              object="gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT/plan.tfplan"
              gcloud storage cp "$TF_PLAN_FILE" "$object" --if-generation-match=0 --quiet
              generation=$(gcloud storage objects describe "$object" --raw --format='value(generation)')
            ''
          else
            ''
              # A private repository can keep the plan in its one-day Actions artifact.
              cp "$TF_PLAN_FILE" "$TF_PLAN_DIR/artifact/plan.tfplan"
            ''
        )
        + ''
          jq -n --arg sha256 "$digest" --arg backend "$backend" --arg generation "$generation" '
            {schema: 1, storage: "${storage}", sha256: $sha256, backend: $backend} +
            (if $generation == "" then {} else {generation: $generation} end)
          ' > "$TF_PLAN_DIR/artifact/plan.json"
        '';
    };
  # Verify the producer, revision, expiry and digest before applying the saved plan.
  applyPlan =
    storage:
    pkgs.writeShellApplication {
      name = "apply-${storage}";
      runtimeInputs = tools ++ lib.optionals (storage == "gcs") [ pkgs.google-cloud-sdk ];
      text =
        setup
        + lib.optionalString (storage == "github") privateRepository
        + ''
          : "''${PLAN_ARTIFACT_ID:?Select a Plan artifact ID}"
          [[ "$PLAN_ARTIFACT_ID" =~ ^[1-9][0-9]*$ ]]
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          repo_dir="$PWD"
          cd "$TF_PLAN_DIR/private"
          gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$PLAN_ARTIFACT_ID" > artifact.json
          jq -e --arg id "$PLAN_ARTIFACT_ID" --arg repo "$GITHUB_REPOSITORY_ID" --arg sha "$GITHUB_SHA" '
            .id == ($id | tonumber) and .expired == false and
            .workflow_run.repository_id == ($repo | tonumber) and .workflow_run.head_sha == $sha and
            (.created_at | fromdateiso8601) <= now and
            (.created_at | fromdateiso8601) > now - 86400 and
            (.expires_at | fromdateiso8601) > now and
            (.digest | test("^sha256:[a-f0-9]{64}$"))
          ' artifact.json > /dev/null
          # A run can be rerun: validate the original producing attempt, not the latest.
          read -r run_id attempt < <(jq -er '
            .name | capture("^plan-(?<run>[1-9][0-9]*)-(?<attempt>[1-9][0-9]*)$") |
            [.run, .attempt] | @tsv' artifact.json)
          test "$(jq -r '.workflow_run.id' artifact.json)" = "$run_id"
          gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/attempts/$attempt" > run.json
          jq -e --arg run "$run_id" --arg attempt "$attempt" --arg repo "$GITHUB_REPOSITORY" \
            --arg repo_id "$GITHUB_REPOSITORY_ID" --arg sha "$GITHUB_SHA" '
            .id == ($run | tonumber) and .run_attempt == ($attempt | tonumber) and
            .repository.full_name == $repo and .repository.id == ($repo_id | tonumber) and
            .head_sha == $sha and .path == ".github/workflows/plan.yaml" and
            .event == "workflow_dispatch" and .head_branch == "main" and
            .status == "completed" and .conclusion == "success"
          ' run.json > /dev/null
          gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$PLAN_ARTIFACT_ID/zip" > artifact.zip
          digest=$(jq -r '.digest | ltrimstr("sha256:")' artifact.json)
          printf '%s  artifact.zip\n' "$digest" | sha256sum --check --status
          # Read only expected members into fixed paths, never arbitrary ZIP paths.
        ''
        + (
          if storage == "gcs" then
            ''
              test "$(unzip -Z1 artifact.zip)" = plan.json
            ''
          else
            ''
              test "$(unzip -Z1 artifact.zip | LC_ALL=C sort)" = $'plan.json\nplan.tfplan'
            ''
        )
        + ''
          unzip -p artifact.zip plan.json > receipt.json
          jq -e --arg backend "$backend" '
            .schema == 1 and .storage == "${storage}" and .backend == $backend and
            (.sha256 | test("^[a-f0-9]{64}$"))
          ' receipt.json > /dev/null
        ''
        + (
          if storage == "gcs" then
            privateBucket
            + ''
              generation=$(jq -er '.generation | select(test("^[1-9][0-9]*$"))' receipt.json)
              object="gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/$run_id/$attempt/plan.tfplan#$generation"
              gcloud storage cp "$object" "$TF_PLAN_FILE" --quiet
            ''
          else
            ''
              unzip -p artifact.zip plan.tfplan > "$TF_PLAN_FILE"
            ''
        )
        + ''
          digest=$(jq -r .sha256 receipt.json)
          printf '%s  %s\n' "$digest" "$TF_PLAN_FILE" | sha256sum --check --status
          test "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" = "$GITHUB_SHA"
          cd "$repo_dir"
          # Do not replan: approval covers this saved plan. OpenTofu retains its
          # backend lock and rejects stale plans when remote state has changed.
          ${lib.getExe cfg.apply.package} > "$TF_PLAN_DIR/private/apply.log" 2>&1 || {
            echo "Apply failed; inspect state before authorizing a new Plan or retry." >&2
            exit 1
          }
        '';
    };
in
{
  options.quantile.opentofu = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.opentofu;
      description = "OpenTofu CLI.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-terraform";
        runtimeInputs = [
          tofu
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          if [ "$#" -gt 0 ]; then
            echo 'Usage: check-terraform' >&2
            exit 2
          fi
          tf_dir="''${TF_DIR:-tf}"
          root=$(cd "$tf_dir" && pwd -P)
          git_dir=$(git -C "$root" rev-parse --absolute-git-dir)
          # Isolate each root from its production .terraform backend metadata and
          # from other roots. The caller's TF_DATA_DIR must never redirect checks.
          hash=$(printf '%s' "$root" | sha256sum | cut -d ' ' -f1)
          state="''${DEVENV_STATE:-$git_dir/factory}"
          export TF_DATA_DIR="$state/tofu-check/$hash"
          mkdir -p "$TF_DATA_DIR"
          for name in "''${!TF_CLI_ARGS@}" "''${!TF_LOG@}"; do unset "$name"; done
          tofu -chdir="$root" init -backend=false -input=false -lockfile=readonly
          tofu -chdir="$root" validate -no-color
        '';
      };
      description = "Validate a backend-free Terraform root with isolated module data.";
    };

    format.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-terraform-format";
        runtimeInputs = [ tofu ];
        text = ''
          tofu -chdir="''${TF_DIR:-tf}" fmt -check -recursive
        '';
      };
      description = "Read-only recursive Terraform formatting check for one selected source directory.";
    };

    nonempty.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-terraform-nonempty";
        runtimeInputs = [
          pkgs.git
          pkgs.gnugrep
        ];
        text = ''
          if [ "$#" -eq 0 ]; then set -- "''${TF_DIR:-tf}"; fi
          git ls-files -z -- "$@" |
          while IFS= read -r -d "" file; do
            case "$file" in *.tf|*.tofu) ;; *) continue ;; esac
            if [ ! -f "$file" ] || [ -L "$file" ]; then continue; fi
            result=0
            grep -q '[^[:space:]]' -- "$file" || result=$?
            if [ "$result" -gt 1 ]; then exit "$result"; fi
            if [ "$result" -eq 1 ]; then
              printf 'Empty Terraform file: %s\n' "$file" >&2
              exit 1
            fi
          done
        '';
      };
      description = "Reject empty tracked .tf/.tofu files selected by Git pathspecs (default TF_DIR or tf).";
    };

    fix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "fix-terraform";
        runtimeInputs = [
          tofu
          pkgs.git
          pkgs.findutils
        ];
        text = ''
          cd "''${TF_DIR:-tf}"
          git ls-files -z -- '*.tf' '*.tfvars' '*.tftest.hcl' '*.tofu' '*.tofutest.hcl' |
            while IFS= read -r -d "" file; do
              if [ -f "$file" ] && [ ! -L "$file" ]; then printf '%s\0' "$file"; fi
            done |
            xargs -0 -r tofu fmt --
        '';
      };
      description = "Explicitly format tracked regular Terraform source only; never initialize a backend.";
    };

    # Save the plan for review; Apply must use that same plan without generating a new one.
    # These base commands also work independently with a caller-provided TF_PLAN_FILE.
    plan = {
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "plan-terraform";
          runtimeInputs = [ tofu ];
          text = ''
            tf_dir="''${TF_DIR:-tf}"
            : "''${TF_PLAN_FILE:?Set an absolute output path for the saved plan}"
            case "$TF_PLAN_FILE" in /*) ;; *) echo "TF_PLAN_FILE must be absolute" >&2; exit 1 ;; esac
            test ! -e "$TF_PLAN_FILE"
            umask 077
            ${remoteInit}
            tofu -chdir="$tf_dir" plan -input=false -no-color -out="$TF_PLAN_FILE"
          '';
        };
        description = "Save a Terraform plan.";
      };
      github.package = lib.mkOption {
        type = lib.types.package;
        default = savePlan "github";
        description = "Save a Terraform plan to GitHub.";
      };
      gcs.package = lib.mkOption {
        type = lib.types.package;
        default = savePlan "gcs";
        description = "Save a Terraform plan to GCS.";
      };
    };

    apply = {
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "apply-terraform";
          runtimeInputs = [ tofu ];
          text = ''
            tf_dir="''${TF_DIR:-tf}"
            : "''${TF_PLAN_FILE:?Set an absolute path to the saved plan}"
            case "$TF_PLAN_FILE" in /*) ;; *) echo "TF_PLAN_FILE must be absolute" >&2; exit 1 ;; esac
            test -s "$TF_PLAN_FILE"
            ${remoteInit}
            tofu -chdir="$tf_dir" apply -input=false "$TF_PLAN_FILE"
          '';
        };
        description = "Apply a Terraform plan.";
      };
      github.package = lib.mkOption {
        type = lib.types.package;
        default = applyPlan "github";
        description = "Apply a Terraform plan from GitHub.";
      };
      gcs.package = lib.mkOption {
        type = lib.types.package;
        default = applyPlan "gcs";
        description = "Apply a Terraform plan from GCS.";
      };
    };
  };
}
