{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.mypy;
  selected =
    name: package: command:
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
        if (( ''${#paths[@]} == 0 )); then paths=( '*.py' '*.pyi' ); fi
        scratch=$(mktemp -d)
        trap 'rm -rf -- "$scratch"' EXIT
        git ls-files --cached --others --exclude-standard -z -- "''${paths[@]}" > "$scratch/paths"
        files=()
        while IFS= read -r -d "" file; do
          if [ -f "$file" ] && [ ! -L "$file" ] &&
            [[ "$file" == *.py || "$file" == *.pyi ]]; then
            files+=("$file")
          fi
        done < "$scratch/paths"
        if (( ''${#files[@]} == 0 )); then exit 0; fi
        ${command}
      '';
    };
in
{
  imports = [ ../python ];
  options.quantile.mypy = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.mypy;
      description = "mypy CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/mypy/mypy.ini;
      description = "mypy configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-mypy" cfg.package ''
        config="''${MYPY_CONFIG_FILE:-mypy.ini}"
        test -f "$config" || { echo "Missing native mypy config: $config" >&2; exit 1; }
        version="''${MYPY_PYTHON_VERSION:-${config.quantile.python.package.pythonVersion}}"
        export MYPY_CACHE_DIR="$scratch/mypy-cache"
        status=0
        for file in "''${files[@]}"; do
          mypy --config-file "$config" --python-version "$version" \
            --namespace-packages --explicit-package-bases -- "$file" || status=1
        done
        exit "$status"
      '';
      description = "Type-check Python.";
    };
  };
}
