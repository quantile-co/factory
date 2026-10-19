{
  lib,
  pkgs,
  ...
}:
let
  runner =
    name: includeUntracked: action:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        pkgs.git
        pkgs.coreutils
      ];
      text = ''
        cd "$(git rev-parse --show-toplevel)"
        : "''${PRETTIER_BIN:?Set PRETTIER_BIN to the project-local or Nix-provided prettier executable}"
        command -v "$PRETTIER_BIN" > /dev/null || {
          echo "Prettier executable not found: $PRETTIER_BIN" >&2
          exit 1
        }
        if (( $# == 0 )); then
          echo "Pass explicit Git pathspecs for files owned by Prettier." >&2
          exit 2
        fi
        ignore="''${PRETTIER_IGNORE_FILE:-.prettierignore}"
        if [ ! -f "$ignore" ]; then
          echo "Missing native Prettier ignore file: $ignore" >&2
          exit 1
        fi
        ignore=$(realpath -e -- "$ignore")
        config="''${PRETTIER_CONFIG_FILE:-.prettierrc.json}"
        config_args=()
        if [ "$config" != auto ]; then
          if [ ! -f "$config" ]; then
            echo "Missing native Prettier configuration: $config" >&2
            exit 1
          fi
          config_args=(--config "$config")
        fi
        scratch=$(mktemp -d)
        trap 'rm -rf -- "$scratch"' EXIT
        git ls-files --cached ${lib.optionalString includeUntracked "--others --exclude-standard"} -z -- "$@" > "$scratch/files"
        # Git interprets checkout-relative native ignores and .gitignore for both
        # tracked and untracked files. Prettier then receives only literal paths.
        status=0
        git -c "core.excludesFile=$ignore" check-ignore \
          --no-index --stdin --non-matching --verbose -z \
          < "$scratch/files" > "$scratch/classified" || status=$?
        if (( status > 1 )); then exit "$status"; fi
        selected=()
        while IFS= read -r -d "" origin && IFS= read -r -d "" _line &&
              IFS= read -r -d "" pattern && IFS= read -r -d "" file; do
          if [ -z "$origin" ] || [[ "$pattern" == '!'* ]]; then
            if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
          fi
        done < "$scratch/classified"
        if (( ''${#selected[@]} == 0 )); then exit 0; fi
        "$PRETTIER_BIN" ${action} --ignore-path /dev/null "''${config_args[@]}" -- "''${selected[@]}"
      '';
    };
in
{
  options.quantile.prettier = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.prettier;
      description = "Optional Prettier CLI; a project-pinned executable also works.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/prettier/.prettierrc.json;
      description = "Prettier style template.";
    };
    ignoreFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/prettier/.prettierignore;
      description = "Prettier ignore template, relative to the checkout.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = runner "check-prettier" true "--check";
      description = "Read-only Git-selected formatting check; requires PRETTIER_BIN and explicit pathspecs.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = runner "fix-prettier" false "--write";
      description = "Explicit formatting of tracked regular selected files only; requires PRETTIER_BIN and pathspecs.";
    };
  };
}
