{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.yamllint;
in
{
  options.quantile-co.factory.yamllint = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.yamllint;
      description = "yamllint CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/yamllint/.yamllint.yaml;
      description = "Native yamllint configuration template for consumer placement.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-yamllint";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${YAMLLINT_CONFIG_FILE:-.yamllint.yaml}"
          if [ ! -f "$config" ]; then
            echo 'yamllint requires consumer-native .yamllint.yaml (or YAMLLINT_CONFIG_FILE)' >&2
            exit 1
          fi
          if [ "$#" -eq 0 ]; then set -- '*.yaml' '*.yml'; fi
          files=$(mktemp)
          trap 'rm -f -- "$files"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "$@" > "$files"
          selected=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
          done < "$files"
          if [ "''${#selected[@]}" -eq 0 ]; then exit 0; fi
          yamllint --config-file "$config" -- "''${selected[@]}"
        '';
      };
      description = "Check YAML.";
    };
  };
}
