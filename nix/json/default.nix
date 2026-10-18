{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.json;
in
{
  options.quantile.json = {
    jq.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.jq;
      description = "jq.";
    };
    prek.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.prek;
      description = "Prek hook runner.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-json";
        runtimeInputs = [ cfg.prek.package pkgs.python3Packages.pre-commit-hooks pkgs.git ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${GIT_HOOKS_CONFIG:-.pre-commit-config.yaml}"
          test -f "$config" || { echo "Missing native Prek config: $config" >&2; exit 1; }
          prek --config "$config" run check-json --all-files --hook-stage pre-push
        '';
      };
      description = "Read-only strict JSON validation using the consumer's Prek configuration.";
    };
  };
}
