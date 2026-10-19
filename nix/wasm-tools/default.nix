{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.wasm-tools;
in
{
  options.quantile.wasm-tools = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.wasm-tools;
      description = "wasm-tools CLI.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-wasm-tools";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ "$#" -eq 0 ]; then set -- '*.wasm'; fi
          files=$(mktemp)
          trap 'rm -f -- "$files"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "$@" > "$files"
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then
              case "$file" in *.wasm) wasm-tools validate -- "$file" ;; esac
            fi
          done < "$files"
        '';
      };
      description = "Read-only validation of Git-selected WebAssembly binary modules.";
    };
  };
}
