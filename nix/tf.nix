{ config, lib, pkgs, ... }:
let
  tofu = config.quantile.tf.opentofu.package;
  remoteInit = ''
    : "''${GCP_TF_STATE_BUCKET:?Missing state bucket}"
    : "''${TF_BACKEND_PREFIX:?Missing backend prefix}"
    tofu -chdir="$tf_dir" init -input=false -lockfile=readonly \
      -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
      -backend-config="prefix=$TF_BACKEND_PREFIX"
  '';
in
{
  options.quantile.tf = {
    opentofu.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.opentofu;
      description = "OpenTofu CLI.";
    };

    conftest.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.conftest;
      description = "Conftest CLI.";
    };

    trivy.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.trivy;
      description = "Trivy CLI.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-terraform";
        runtimeInputs = [ tofu ];
        text = ''
          tf_dir="''${TF_DIR:-tf}"
          tofu -chdir="$tf_dir" fmt -check -recursive
          tofu -chdir="$tf_dir" init -backend=false -input=false -lockfile=readonly
          tofu -chdir="$tf_dir" validate -no-color
        '';
      };
      description = "Terraform check.";
    };

    plan.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "plan-production";
        runtimeInputs = [ tofu ];
        text = ''
          tf_dir="''${TF_DIR:-tf}"
          ${remoteInit}
          tofu -chdir="$tf_dir" plan -input=false -no-color
        '';
      };
      description = "Production plan.";
    };

    apply.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "apply-production";
        runtimeInputs = [ tofu ];
        text = ''
          tf_dir="''${TF_DIR:-tf}"
          ${remoteInit}
          umask 077
          plan_dir=$(mktemp -d "''${TMPDIR:-/tmp}/tofu-plan.XXXXXXXX")
          trap 'rm -rf -- "$plan_dir"' EXIT
          plan="$plan_dir/plan.tfplan"
          tofu -chdir="$tf_dir" plan -input=false -out="$plan"
          tofu -chdir="$tf_dir" apply -input=false "$plan"
        '';
      };
      description = "Production apply.";
    };
  };
}
