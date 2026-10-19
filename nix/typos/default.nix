{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.typos;
in
{
  options.quantile.typos = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.typos;
      description = "typos CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/typos/typos.toml;
      description = "Optional native typos configuration template for consumer placement.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-typos";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${TYPOS_CONFIG_FILE:-typos.toml}"
          if [ ! -f "$config" ]; then
            echo 'typos requires consumer-native typos.toml (or TYPOS_CONFIG_FILE)' >&2
            exit 1
          fi
          config=$(realpath "$config")
          if [ "$#" -eq 0 ]; then set -- .; fi
          files=$(mktemp)
          trap 'rm -f -- "$files"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "$@" > "$files"
          selected=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
          done < "$files"
          if [ "''${#selected[@]}" -eq 0 ]; then exit 0; fi
          typos --config "$config" --force-exclude -- "''${selected[@]}"
        '';
      };
      description = "Read-only spelling check of Git-selected source using consumer-native typos policy.";
    };
  };
}
