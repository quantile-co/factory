{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.python;
  target = "py${lib.replaceStrings [ "." ] [ "" ] cfg.package.pythonVersion}";
  selected =
    name: includeUntracked: includeStubs: package: command:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        package
        pkgs.git
        pkgs.coreutils
      ];
      text = ''
        cd "$(git rev-parse --show-toplevel)"
        paths=("$@")
        if (( ''${#paths[@]} == 0 )); then
          paths=( '*.py' ${lib.optionalString includeStubs "'*.pyi'"} )
        fi
        scratch=$(mktemp -d)
        trap 'rm -rf -- "$scratch"' EXIT
        git ls-files --cached ${lib.optionalString includeUntracked "--others --exclude-standard"} -z -- "''${paths[@]}" > "$scratch/paths"
        files=()
        while IFS= read -r -d "" file; do
          if [ -f "$file" ] && [ ! -L "$file" ] &&
             [[ "$file" == *.py ${lib.optionalString includeStubs "|| \"$file\" == *.pyi"} ]]; then
            files+=("$file")
          fi
        done < "$scratch/paths"
        if (( ''${#files[@]} == 0 )); then exit 0; fi
        ${command}
      '';
    };
  ruffConfig = ''
    config="''${RUFF_CONFIG_FILE:-ruff.toml}"
    test -f "$config" || { echo "Missing native Ruff config: $config" >&2; exit 1; }
    target="''${RUFF_TARGET_VERSION:-${target}}"
  '';
in
{
  options.quantile.python = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.python3;
      description = "Selected Python interpreter; determines Ruff and mypy target versions unless overridden at runtime.";
    };
    uv.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.uv;
      description = "uv CLI; installing it does not sync project dependencies.";
    };
    ruff.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.ruff;
      description = "Ruff formatter and linter CLI.";
    };
    ruff.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/python/ruff.toml;
      description = "Optional native Ruff policy template; consumers choose its placement.";
    };
    mypy.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.mypy;
      description = "mypy CLI.";
    };
    mypy.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/python/mypy.ini;
      description = "Optional native mypy policy template; consumers choose its placement.";
    };
    check.ruff.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-ruff" true true cfg.ruff.package ''
        ${ruffConfig}
        ruff check --no-cache --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Read-only Ruff lint on Git-selected regular Python source.";
    };
    check.format.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-format" true true cfg.ruff.package ''
        ${ruffConfig}
        ruff format --check --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Read-only Ruff formatting check on Git-selected Python source.";
    };
    check.mypy.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-mypy" true true cfg.mypy.package ''
        config="''${MYPY_CONFIG_FILE:-mypy.ini}"
        test -f "$config" || { echo "Missing native mypy config: $config" >&2; exit 1; }
        version="''${MYPY_PYTHON_VERSION:-${cfg.package.pythonVersion}}"
        export MYPY_CACHE_DIR="$scratch/mypy-cache"
        status=0
        for file in "''${files[@]}"; do
          mypy --config-file "$config" --python-version "$version" \
            --namespace-packages --explicit-package-bases -- "$file" || status=1
        done
        exit "$status"
      '';
      description = "Read-only mypy type check on Git-selected Python files, one at a time to avoid duplicate module names.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = selected "fix-python" false false cfg.ruff.package ''
        ${ruffConfig}
        ruff check --fix --no-cache --config "$config" --target-version "$target" -- "''${files[@]}"
        ruff format --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Explicit safe Ruff lint fixes followed by formatting of tracked regular .py files only.";
    };
  };
}
