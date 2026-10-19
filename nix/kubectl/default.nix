{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.kubectl;
in
{
  options.quantile.kubectl = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.kubectl;
      description = "kubectl CLI used by the host-plugin-safe wrapper.";
    };
    safePackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "kubectl";
        text = ''
          IFS=: read -r -a components <<< "$PATH"
          paths=()
          for component in "''${components[@]}"; do
            case "$component" in
              */.krew/bin|*/.krew/bin/) ;;
              *) paths+=("$component") ;;
            esac
          done
          PATH=$(IFS=:; printf '%s' "''${paths[*]}")
          export PATH
          exec ${cfg.package}/bin/kubectl "$@"
        '';
      };
      description = "kubectl without inherited .krew/bin plugin paths.";
    };
  };
}
