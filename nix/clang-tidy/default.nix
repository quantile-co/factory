{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.clang-tidy;
in
{
  options.quantile.clang-tidy = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.clang-tools;
      description = "clang-tidy executable from the selected Clang tools release.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/clang-tidy/.clang-tidy;
      description = "Native clang-tidy policy template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-clang-tidy";
        runtimeInputs = [
          cfg.package
          pkgs.coreutils
          pkgs.file
          pkgs.git
          pkgs.jq
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          files=()
          if (( $# )); then
            for file in "$@"; do
              git ls-files --error-unmatch -- ":(literal)$file" > /dev/null || {
                echo "C/C++ source is not tracked: $file" >&2
                exit 1
              }
            done
            candidates=("$@")
          else
            mapfile -d "" -t candidates < <(git ls-files -z -- '*.c' '*.cpp' '*.cc' '*.cxx')
          fi
          for file in "''${candidates[@]}"; do
            case "$file" in *.c|*.cpp|*.cc|*.cxx) ;; *) continue ;; esac
            case "$file" in build/*|*/build/*|vendor/*|*/vendor/*|third_party/*|*/third_party/*) continue ;; esac
            if [ -n "''${C_EXCLUDE_REGEX:-}" ] && [[ "$file" =~ $C_EXCLUDE_REGEX ]]; then continue; fi
            if [ -L "$file" ] || [ ! -f "$file" ]; then continue; fi
            if [ "$(file --brief --mime-encoding -- "$file")" = binary ]; then continue; fi
            files+=("$file")
          done
          if (( ''${#files[@]} == 0 )); then exit 0; fi
          database_dir="''${CLANG_TIDY_COMPILE_COMMANDS_DIR:-.}"
          database="$database_dir/compile_commands.json"
          if [ ! -f "$database" ]; then
            echo "clang-tidy requires a compilation database: $database" >&2
            exit 1
          fi
          jq -e 'type == "array" and length > 0 and all(.[];
            (.directory | type == "string") and (.file | type == "string"))' "$database" > /dev/null
          tmp=$(mktemp -d)
          trap 'rm -rf "$tmp"' EXIT
          jq -j '.[] | .directory, "\u0000", .file, "\u0000"' "$database" > "$tmp/entries"
          declare -A compiled=()
          while IFS= read -r -d "" directory && IFS= read -r -d "" file; do
            if [[ "$file" != /* ]]; then file="$directory/$file"; fi
            compiled["$(realpath -m -- "$file")"]=1
          done < "$tmp/entries"
          config_args=()
          if [ -n "''${CLANG_TIDY_CONFIG:-}" ]; then
            test -f "$CLANG_TIDY_CONFIG"
            config_args=("--config-file=$CLANG_TIDY_CONFIG")
          fi
          for file in "''${files[@]}"; do
            source=$(realpath -- "$file")
            if [[ -z "''${compiled[$source]:-}" ]]; then
              echo "No compilation database entry for: $file" >&2
              exit 1
            fi
            clang-tidy "''${config_args[@]}" -p "$database_dir" "$source"
          done
        '';
      };
      description = "Read-only compilation-database-backed C/C++ analysis.";
    };
  };
}
