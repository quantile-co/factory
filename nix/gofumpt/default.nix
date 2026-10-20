{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.gofumpt;
  source =
    name: check:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        cfg.package
        pkgs.git
      ];
      text = ''
        set -euo pipefail
        cd "$(git rev-parse --show-toplevel)"
        case "''${GOFUMPT_EXTRA:-1}" in
          1) extra=(-extra) ;;
          0) extra=() ;;
          *) echo 'GOFUMPT_EXTRA must be 0 or 1.' >&2; exit 2 ;;
        esac
        if (( $# )); then paths=("$@"); else paths=( '*.go' ); fi
        paths+=( ':(exclude)*.pb.go' ':(exclude)*.gen.go' ':(exclude)*_templ.go' ':(exclude)vendor/**' )
        files=()
        while IFS= read -r -d "" file; do
          if [[ "$file" == *.go && -f "$file" && ! -L "$file" ]]; then files+=("$file"); fi
        done < <(git ls-files -z --cached ${lib.optionalString check "--others --exclude-standard"} -- "''${paths[@]}")
        if (( ''${#files[@]} == 0 )); then echo 'No Go source selected.' >&2; exit 1; fi
        ${
          if check then
            ''
              unformatted=$(gofumpt "''${extra[@]}" -l -- "''${files[@]}")
              if [ -n "$unformatted" ]; then printf 'Go formatting differs:\n%s\n' "$unformatted" >&2; exit 1; fi
            ''
          else
            ''
              gofumpt "''${extra[@]}" -w -- "''${files[@]}"
            ''
        }
      '';
    };
in
{
  options.quantile.gofumpt = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.gofumpt;
      description = "gofumpt formatter.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-gofumpt" true;
      description = "Read-only formatting check of Git-selected Go files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = source "fix-gofumpt" false;
      description = "Format selected tracked Go files.";
    };
  };
}
