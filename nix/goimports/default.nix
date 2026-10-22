{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.goimports;
  source =
    name: check:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        cfg.package
        config.quantile-co.factory.go.package
        pkgs.git
      ];
      text = ''
        set -euo pipefail
        cd "$(git rev-parse --show-toplevel)"
        unset GOROOT GOBIN
        export GOTOOLCHAIN=local GOPROXY=off
        if (( $# )); then paths=("$@"); else paths=( '*.go' ); fi
        paths+=( ':(exclude)*.pb.go' ':(exclude)*.gen.go' ':(exclude)*_templ.go' ':(exclude)vendor/**' )
        files=()
        while IFS= read -r -d "" file; do
          if [[ "$file" == *.go && -f "$file" && ! -L "$file" ]]; then files+=("$file"); fi
        done < <(git ls-files -z --cached ${lib.optionalString check "--others --exclude-standard"} -- "''${paths[@]}")
        if (( ''${#files[@]} == 0 )); then echo 'No Go source selected.' >&2; exit 1; fi
        local_args=()
        if [ -n "''${GOIMPORTS_LOCAL:-}" ]; then local_args=(-local "$GOIMPORTS_LOCAL"); fi
        ${
          if check then
            ''
              unformatted=$(goimports "''${local_args[@]}" -l -- "''${files[@]}")
              if [ -n "$unformatted" ]; then printf 'Go imports differ:\n%s\n' "$unformatted" >&2; exit 1; fi
            ''
          else
            ''
              goimports "''${local_args[@]}" -w -- "''${files[@]}"
            ''
        }
      '';
    };
in
{
  imports = [
    ../go
    ../gotools
  ];
  options.quantile-co.factory.goimports = {
    package = lib.mkOption {
      type = lib.types.package;
      default = config.quantile-co.factory.gotools.package;
      description = "goimports formatter.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-goimports" true;
      description = "Read-only import formatting check of Git-selected Go files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = source "fix-goimports" false;
      description = "Format imports in selected tracked Go files.";
    };
  };
}
