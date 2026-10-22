{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.markdownlint-cli2;
in
{
  options.quantile-co.factory.markdownlint-cli2 = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.markdownlint-cli2;
      description = "markdownlint-cli2 CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/markdownlint-cli2/.markdownlint-cli2.jsonc;
      description = "Markdownlint configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-markdown";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${MARKDOWNLINT_CONFIG_FILE:-.markdownlint-cli2.jsonc}"
          test -f "$config" || { echo "Missing native Markdown config: $config" >&2; exit 1; }
          paths=("$@")
          if (( ''${#paths[@]} == 0 )); then
            paths=( '*.md' ':(exclude,glob).pi/memory/**' )
          fi
          work=$(mktemp)
          trap 'rm -f -- "$work"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "''${paths[@]}" > "$work"
          selected=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then
              # CLI2 treats ordinary arguments as globs; ':' selects an exact file.
              selected+=(":$file")
            fi
          done < "$work"
          if (( ''${#selected[@]} == 0 )); then exit 0; fi
          markdownlint-cli2 --no-globs --config "$config" "''${selected[@]}"
        '';
      };
      description = "Read-only Git-selected Markdown lint, using the consumer's native configuration.";
    };
  };
}
