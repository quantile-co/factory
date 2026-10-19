{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.trivy;
in
{
  options.quantile.trivy = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.trivy;
      description = "Trivy CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/trivy/trivy.yaml;
      description = "Optional native Trivy configuration template for consumer placement.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-trivy";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${TRIVY_CONFIG_FILE:-trivy.yaml}"
          if [ ! -f "$config" ]; then
            echo 'Trivy requires consumer-native trivy.yaml (or TRIVY_CONFIG_FILE)' >&2
            exit 1
          fi
          config=$(realpath "$config")
          if [ "$#" -eq 0 ]; then set -- .; fi
          for root in "$@"; do
            if [ ! -d "$root" ]; then
              printf 'Missing Trivy scan directory: %s\n' "$root" >&2
              exit 1
            fi
            trivy repo --config "$config" -- "$root"
          done
        '';
      };
      description = "Read-only repository-source scan of caller-selected roots using native Trivy policy.";
    };
  };
}
