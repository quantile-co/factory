{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.ruff;
  target = "py${
    lib.replaceStrings [ "." ] [ "" ] config.quantile-co.factory.python.package.pythonVersion
  }";
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
  imports = [ ../python ];
  options.quantile-co.factory.ruff = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.ruff;
      description = "Ruff formatter and linter CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/ruff/ruff.toml;
      description = "Ruff configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-ruff" true true cfg.package ''
        ${ruffConfig}
        ruff check --no-cache --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Read-only Ruff lint on Git-selected regular Python source.";
    };
    format.check.package = lib.mkOption {
      type = lib.types.package;
      default = selected "check-python-format" true true cfg.package ''
        ${ruffConfig}
        ruff format --check --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Read-only Ruff formatting check on Git-selected Python source.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = selected "fix-python" false false cfg.package ''
        ${ruffConfig}
        ruff check --fix --no-cache --config "$config" --target-version "$target" -- "''${files[@]}"
        ruff format --config "$config" --target-version "$target" -- "''${files[@]}"
      '';
      description = "Explicit safe Ruff fixes and formatting on tracked regular .py files only.";
    };
  };
}
