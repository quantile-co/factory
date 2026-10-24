{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.vale;
in
{
  options.quantile-co.factory.vale = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.vale;
      description = "Vale CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/vale/.vale.ini;
      description = "Native Vale configuration template for consumer placement.";
    };

    stylesDirectory = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/vale/styles;
      description = "Native Google and Quantile writing styles, including editable vocabulary files.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-vale";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${VALE_CONFIG_FILE:-.vale.ini}"
          if [ ! -f "$config" ]; then
            echo 'Vale requires consumer-native .vale.ini (or VALE_CONFIG_FILE)' >&2
            exit 1
          fi
          # Vale resolves StylesPath relative to this path; do not dereference a linked config.
          # Legal templates retain their authored wording, not prose-style substitutions.
          if [ "$#" -eq 0 ]; then
            set -- '*.md' \
              ':(exclude,glob)**/AGENTS.md' ':(exclude,glob)nix/**/fixtures/**' \
              ':(exclude,glob).pi/memory/**' ':(exclude,glob)packages/pi/skills/**' \
              ':(exclude,glob)etc/license/**'
          fi
          files=$(mktemp)
          trap 'rm -f -- "$files"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "$@" > "$files"
          selected=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
          done < "$files"
          if [ "''${#selected[@]}" -eq 0 ]; then exit 0; fi
          vale --no-global --config "$config" -- "''${selected[@]}"
        '';
      };
      description = "Read-only Vale check of Git-selected prose with consumer-native config and styles.";
    };
  };
}
