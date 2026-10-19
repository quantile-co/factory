{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.tflint;
in
{
  options.quantile.tflint = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.tflint;
      description = "TFLint CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/tflint/.tflint.hcl;
      description = "Optional native TFLint configuration template for consumer placement.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-tflint";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          tf_dir="''${TF_DIR:-tf}"
          config="''${TFLINT_CONFIG_FILE:-$(git -C "$tf_dir" rev-parse --show-toplevel)/.tflint.hcl}"
          if [ ! -f "$config" ]; then
            echo 'TFLint requires consumer-native .tflint.hcl (or TFLINT_CONFIG_FILE)' >&2
            exit 1
          fi
          config=$(realpath "$config")
          tflint --chdir="$tf_dir" --config="$config" --no-color
        '';
      };
      description = "Read-only TFLint check of one explicitly selected Terraform root.";
    };
  };
}
