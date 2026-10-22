{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.wabt;
in
{
  options.quantile-co.factory.wabt = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.wabt;
      description = "WABT tools, including wat2wasm.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-wabt";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ "$#" -eq 0 ]; then set -- '*.wat'; fi
          files=$(mktemp)
          trap 'rm -f -- "$files"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "$@" > "$files"
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then
              case "$file" in *.wat) wat2wasm --output=/dev/null -- "$file" ;; esac
            fi
          done < "$files"
        '';
      };
      description = "Read-only parsing of Git-selected WAT modules without emitted binaries.";
    };
  };
}
