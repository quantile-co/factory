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
    plan.package = lib.mkOption {
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
      description = "Save a Terraform plan to a local file.";
    };

    apply.package = lib.mkOption {
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
      description = "Apply a saved local Terraform plan without replanning.";
    };
  };
}
