{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.opentofu;
  tofu = cfg.package;
in
{
  options.quantile-co.factory.opentofu = {
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
          state="''${QUANTILE_CO_FACTORY_STATE_DIR:-$git_dir/factory}"
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
      description = "Reject empty OpenTofu source files.";
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

  };
}
