{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.editorconfig;
  selectFiles = ''
    cd "$(git rev-parse --show-toplevel)"
    test -f .editorconfig || { echo 'Missing consumer .editorconfig' >&2; exit 1; }
    checker_config="''${EDITORCONFIG_CHECKER_CONFIG:-.editorconfig-checker.json}"
    exclusions=()
    if [ -n "''${EDITORCONFIG_CHECKER_CONFIG:-}" ] || [ -f "$checker_config" ]; then
      test -f "$checker_config" || { echo "Missing EditorConfig Checker config: $checker_config" >&2; exit 1; }
      jq -e '(.Exclude // []) | type == "array" and all(.[]; type == "string")' "$checker_config" > /dev/null
      mapfile -d "" -t exclusions < <(jq -rj '.Exclude[]? | ., "\u0000"' "$checker_config")
    fi
    files=()
    if (( $# )); then
      candidates=("$@")
      for path in "''${candidates[@]}"; do
        git ls-files --error-unmatch -- ":(literal)$path" > /dev/null || {
          echo "EditorConfig source is not tracked: $path" >&2
          exit 1
        }
      done
    else
      mapfile -d "" -t candidates < <(git ls-files -z)
    fi
    matches_pattern() { [[ "$1" =~ $2 ]]; }
    for path in "''${candidates[@]}"; do
      [ -f "$path" ] && [ ! -L "$path" ] || continue
      [ "$(file --brief --mime-encoding -- "$path")" != binary ] || continue
      excluded=false
      for pattern in "''${exclusions[@]}"; do
        if matches_pattern "$path" "$pattern"; then
          excluded=true
          break
        else
          status=$?
          if [ "$status" -ne 1 ]; then
            echo "Invalid EditorConfig exclusion regex: $pattern" >&2
            exit 1
          fi
        fi
      done
      if [ "$excluded" = false ]; then files+=("$path"); fi
    done
    if (( ''${#files[@]} == 0 )); then exit 0; fi
  '';
in
{
  options.quantile-co.factory.editorconfig = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/editorconfig/.editorconfig;
      description = "EditorConfig configuration file.";
    };
    checker.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/editorconfig/.editorconfig-checker.json;
      description = "EditorConfig Checker configuration template.";
    };
    checker.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.editorconfig-checker;
      description = "EditorConfig Checker CLI.";
    };
    fixer.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.python3Packages.pre-commit-hooks;
      description = "Package providing end-of-file-fixer.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-editorconfig";
        runtimeInputs = [
          cfg.checker.package
          pkgs.file
          pkgs.git
          pkgs.jq
        ];
        text = selectFiles + ''
          config_args=()
          if [ -n "''${EDITORCONFIG_CHECKER_CONFIG:-}" ] || [ -f "$checker_config" ]; then
            config_args=(-config "$checker_config")
          fi
          editorconfig-checker "''${config_args[@]}" -- "''${files[@]}"
        '';
      };
      description = "Read-only check of tracked text files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "fix-editorconfig-eof";
        runtimeInputs = [
          cfg.fixer.package
          pkgs.file
          pkgs.git
          pkgs.jq
        ];
        text = selectFiles + ''
          if end-of-file-fixer "''${files[@]}"; then
            :
          else
            status=$?
            if [ "$status" -ne 1 ]; then exit "$status"; fi
            # The fixer reports successful rewrites as 1. Require a clean second pass.
            end-of-file-fixer "''${files[@]}"
          fi
        '';
      };
      description = "Explicit EOF normalization of tracked text files.";
    };
  };
}
