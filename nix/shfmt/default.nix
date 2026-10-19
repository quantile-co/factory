{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.shfmt;
  selected = name: includeUntracked: mode: pkgs.writeShellApplication {
    inherit name;
    runtimeInputs = [ cfg.package pkgs.git pkgs.coreutils ];
    text = ''
      set -euo pipefail
      cd "$(git rev-parse --show-toplevel)"
      test -f .editorconfig || { echo 'Missing native .editorconfig for shfmt.' >&2; exit 1; }
      paths=("$@")
      if (( ''${#paths[@]} == 0 )); then paths=( ${if includeUntracked then "." else "'*.sh'"} ); fi
      scratch=$(mktemp)
      trap 'rm -f -- "$scratch"' EXIT
      git ls-files --cached ${lib.optionalString includeUntracked "--others --exclude-standard"} -z -- "''${paths[@]}" > "$scratch"
      files=()
      while IFS= read -r -d "" file; do
        if [ "$file" = .envrc ] || [ ! -f "$file" ] || [ -L "$file" ]; then continue; fi
        case "$file" in
          *.sh) ;;
          ${lib.optionalString includeUntracked ''
            *.bash) ;;
            *)
              IFS= read -r first < "$file" || :
              [[ "$first" =~ ^#!.*[/[:space:]](bash|sh|dash|ksh)([[:space:]]|$) ]] || continue
              ;;
          ''}
          ${lib.optionalString (!includeUntracked) "*) continue ;;"}
        esac
        files+=("$file")
      done < "$scratch"
      if (( ''${#files[@]} == 0 )); then exit 0; fi
      shfmt ${mode} -- "''${files[@]}"
    '';
  };
in
{
  options.quantile.shfmt = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.shfmt;
      description = "shfmt formatter; style is read from the consumer's .editorconfig.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-shfmt" true "-d";
      description = "Read-only Git-selected shell formatting check.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = selected "fix-shfmt" false "-w";
      description = "Explicit formatting of selected tracked regular .sh files only.";
    };
  };
}
