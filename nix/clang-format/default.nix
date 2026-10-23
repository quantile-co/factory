{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.clang-format;
  selectFiles = ''
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
      mapfile -d "" -t candidates < <(git ls-files -z -- '*.c' '*.h' '*.cpp' '*.hpp' '*.cc' '*.hh' '*.cxx' '*.hxx')
    fi
    for file in "''${candidates[@]}"; do
      case "$file" in *.c|*.h|*.cpp|*.hpp|*.cc|*.hh|*.cxx|*.hxx) ;; *) continue ;; esac
      case "$file" in build/*|*/build/*|vendor/*|*/vendor/*|third_party/*|*/third_party/*) continue ;; esac
      if [ -n "''${C_EXCLUDE_REGEX:-}" ] && [[ "$file" =~ $C_EXCLUDE_REGEX ]]; then continue; fi
      if [ -L "$file" ] || [ ! -f "$file" ]; then continue; fi
      if [ "$(file --brief --mime-encoding -- "$file")" = binary ]; then continue; fi
      files+=("$file")
    done
  '';
  runner =
    name: action:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        cfg.package
        pkgs.file
        pkgs.git
      ];
      text = selectFiles + ''
        for file in "''${files[@]}"; do
          clang-format --style=file ${action} -- "$file"
        done
      '';
    };
in
{
  options.quantile-co.factory.clang-format = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.clang-tools;
      description = "clang-format executable from the selected Clang tools release.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/clang-format/.clang-format;
      description = "Native clang-format policy template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = runner "check-clang-format" "--dry-run --Werror";
      description = "Read-only formatting check of selected tracked C/C++ files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = runner "fix-clang-format" "-i";
      description = "Explicit formatting of selected tracked C/C++ files.";
    };
  };
}
