{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.c;
  # From the Git root, pass tracked paths or scan all tracked C/C++ source.
  # C_EXCLUDE_REGEX adds caller exclusions to build/vendor/third_party. Checks
  # and fixes share selection; hook registration and hook-specific filters belong
  # to the consumer. Native .clang-* files are discovered at runtime, with
  # CLANG_FORMAT_CONFIG / CLANG_TIDY_CONFIG for explicit config paths.
  selectFiles = extensions: ''
    root=$(git rev-parse --show-toplevel)
    cd "$root"
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
      mapfile -d "" -t candidates < <(git ls-files -z -- ${lib.escapeShellArgs (map (extension: "*.${extension}") extensions)})
    fi
    for file in "''${candidates[@]}"; do
      case "$file" in ${lib.concatMapStringsSep "|" (extension: "*.${extension}") extensions}) ;; *) continue ;; esac
      case "$file" in build/*|*/build/*|vendor/*|*/vendor/*|third_party/*|*/third_party/*) continue ;; esac
      if [ -n "''${C_EXCLUDE_REGEX:-}" ] && [[ "$file" =~ $C_EXCLUDE_REGEX ]]; then continue; fi
      # Symlinks (even to source outside the checkout) and binary files are not
      # selected for either checking or fixing.
      if [ -L "$file" ] || [ ! -f "$file" ]; then continue; fi
      if [ "$(file --brief --mime-encoding -- "$file")" = binary ]; then continue; fi
      files+=("$file")
    done
  '';
  formatFiles = selectFiles [ "c" "h" "cpp" "hpp" "cc" "hh" "cxx" "hxx" ];
  tidyFiles = selectFiles [ "c" "cpp" "cc" "cxx" ];
  formatArgs = ''
    style=(--style=file)
    if [ -n "''${CLANG_FORMAT_CONFIG:-}" ]; then
      test -f "$CLANG_FORMAT_CONFIG"
      style=("--style=file:$CLANG_FORMAT_CONFIG")
    fi
  '';
in
{
  options.quantile.c = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.clang-tools;
      description = "Clang tools package (clang-format, clang-tidy and clangd).";
    };
    packages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ cfg.package pkgs.bear pkgs.cmake pkgs.meson pkgs.ninja pkgs.pkg-config ]
        ++ lib.optionals pkgs.stdenv.isLinux [ pkgs.gdb pkgs.valgrind ];
      description = "Optional C/C++ build and debug tools; consumers install only what they select.";
    };
    format.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/clang/.clang-format;
      description = "Native clang-format template; consumers choose where to install it.";
    };
    tidy.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/clang/.clang-tidy;
      description = "Native clang-tidy template; consumers choose where to install it.";
    };
    format.check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-clang-format";
        runtimeInputs = [ cfg.package pkgs.file pkgs.git ];
        text = formatFiles + formatArgs + ''
          for file in "''${files[@]}"; do
            clang-format "''${style[@]}" --dry-run --Werror -- "$file"
          done
        '';
      };
      description = "Read-only formatting check of selected tracked C/C++ files.";
    };
    format.fix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "fix-clang-format";
        runtimeInputs = [ cfg.package pkgs.file pkgs.git ];
        text = formatFiles + formatArgs + ''
          for file in "''${files[@]}"; do
            clang-format "''${style[@]}" -i -- "$file"
          done
        '';
      };
      description = "Explicitly format selected tracked C/C++ files.";
    };
    tidy.check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-clang-tidy";
        runtimeInputs = [ cfg.package pkgs.coreutils pkgs.file pkgs.git pkgs.jq ];
        text = tidyFiles + ''
          if (( ''${#files[@]} == 0 )); then exit 0; fi
          # The caller generates the database and supplies its directory at runtime.
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
