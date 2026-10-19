{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.taplo;
  select = ''
    cd "$(git rev-parse --show-toplevel)"
    config="''${TAPLO_CONFIG_FILE:-taplo.toml}"
    if [ ! -f "$config" ]; then
      echo 'Taplo requires consumer-native taplo.toml (or TAPLO_CONFIG_FILE)' >&2
      exit 1
    fi
    config=$(realpath "$config")
    files=()
    while IFS= read -r -d "" file; do
      if [ -f "$file" ] && [ ! -L "$file" ]; then files+=("$file"); fi
    done < <(git ls-files -z -- '*.toml')
    if [ "''${#files[@]}" -eq 0 ]; then exit 0; fi
  '';
  tools = [ cfg.package pkgs.git pkgs.coreutils ];
in
{
  options.quantile.taplo = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.taplo;
      description = "Taplo CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/taplo/taplo.toml;
      description = "Optional native Taplo configuration template for consumer placement.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-taplo";
        runtimeInputs = tools;
        text = select + ''
          taplo check --config "$config" "''${files[@]}"
        '';
      };
      description = "Read-only Taplo validation of selected tracked regular TOML files.";
    };

    format.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-taplo-format";
        runtimeInputs = tools;
        text = select + ''
          taplo format --check --diff --config "$config" "''${files[@]}"
        '';
      };
      description = "Read-only Taplo formatting check of selected tracked regular TOML files.";
    };

    fix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "fix-taplo";
        runtimeInputs = tools;
        text = select + ''
          taplo format --config "$config" "''${files[@]}"
        '';
      };
      description = "Explicitly format tracked regular TOML files only.";
    };
  };
}
