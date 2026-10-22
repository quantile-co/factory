{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.shellcheck;
in
{
  options.quantile-co.factory.shellcheck = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.shellcheck;
      description = "ShellCheck CLI for shell scripts and Actionlint's embedded-script checks.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/shellcheck/.shellcheckrc;
      description = "ShellCheck configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-shellcheck";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          set -euo pipefail
          cd "$(git rev-parse --show-toplevel)"
          rc="''${SHELLCHECK_CONFIG_FILE:-.shellcheckrc}"
          test -f "$rc" || { echo "Missing ShellCheck config: $rc" >&2; exit 1; }
          paths=("$@")
          if (( ''${#paths[@]} == 0 )); then paths=( . ); fi
          scratch=$(mktemp)
          trap 'rm -f -- "$scratch"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "''${paths[@]}" > "$scratch"
          files=()
          while IFS= read -r -d "" file; do
            if [ "$file" = .envrc ] || [ ! -f "$file" ] || [ -L "$file" ]; then continue; fi
            case "$file" in
              *.sh|*.bash) ;;
              *)
                IFS= read -r first < "$file" || :
                [[ "$first" =~ ^#!.*[/[:space:]](bash|sh|dash|ksh)([[:space:]]|$) ]] || continue
                ;;
            esac
            files+=("$file")
          done < "$scratch"
          if (( ''${#files[@]} == 0 )); then exit 0; fi
          shellcheck --rcfile "$rc" -- "''${files[@]}"
        '';
      };
      description = "Read-only Git-selected shell source lint, excluding .envrc.";
    };
    taskCheck.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-shellcheck-task";
        runtimeInputs = [
          cfg.package
          pkgs.coreutils
        ];
        text = ''
          set -euo pipefail
          rc="''${SHELLCHECK_CONFIG_FILE:-.shellcheckrc}"
          test -f "$rc" || { echo "Missing ShellCheck config: $rc" >&2; exit 1; }
          if [ "$#" -lt 1 ]; then echo 'Pass a task name and optional environment variable names; pipe its shell body on stdin.' >&2; exit 2; fi
          task="$1"
          shift
          scratch=$(mktemp)
          trap 'rm -f -- "$scratch"' EXIT
          printf '#!/usr/bin/env bash\n' > "$scratch"
          for name in "$@"; do
            [[ "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Invalid environment variable name: $name" >&2; exit 2; }
            printf "export %s=''\n" "$name" >> "$scratch"
          done
          cat >> "$scratch"
          shellcheck --rcfile "$rc" -- "$scratch" || { echo "ShellCheck failed for task: $task" >&2; exit 1; }
        '';
      };
      description = "Statically lint one task body from stdin using environment names, never values.";
    };
  };
}
