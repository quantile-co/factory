{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.checkov;
  # Isolate Checkov from the main package set: its current package has an
  # insecure ecdsa dependency. Do not allow insecure packages globally.
  isolatedPackages =
    import
      (builtins.fetchTarball {
        url = "https://github.com/NixOS/nixpkgs/archive/b3da656039dc7a6240f27b2ef8cc6a3ef3bccae7.tar.gz";
        sha256 = "sha256-I4puXmX1iovcCHZlRmztO3vW0mAbbRvq4F8wgIMQ1MM=";
      })
      {
        inherit (pkgs.stdenv.hostPlatform) system;
        config = { };
      };
in
{
  options.quantile-co.factory.checkov = {
    package = lib.mkOption {
      type = lib.types.package;
      default = isolatedPackages.checkov;
      description = "Isolated Checkov CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/checkov/.checkov.yaml;
      description = "Checkov configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-checkov";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.jq
          pkgs.yq-go
        ];
        text = ''
          # Do not import a different Python's packages from the caller's shell.
          unset PYTHONPATH PYTHONHOME PYTHONUSERBASE
          cd "$(git rev-parse --show-toplevel)"
          if [ -n "''${CHECKOV_CONFIG_FILE:-}" ]; then
            config_file=$CHECKOV_CONFIG_FILE
          elif [ -f .checkov.yaml ]; then
            config_file=.checkov.yaml
          else
            config_file=.checkov.yml
          fi
          if [ ! -f "$config_file" ]; then
            echo "Missing native Checkov config: $config_file" >&2
            exit 1
          fi
          settings=$(yq -o=json -I=0 '.' "$config_file")
          # Checkov silently skips missing roots, and HIGH without platform
          # metadata can pass without running a local check. Fail closed.
          if ! jq -e '
            (.directory | type == "array" and length > 0 and all(.[]; type == "string" and length > 0)) and
            (.framework | type == "array" and length > 0 and all(.[];
              type == "array" and length > 0 and all(.[]; type == "string" and length > 0))) and
            (."skip-download" == true) and (."skip-results-upload" == true) and
            (."download-external-modules" == false) and
            all((.check // []) + (."skip-check" // []) | .[];
              type == "string" and test("^CKV2?_[A-Za-z0-9_*]+$"))
          ' <<< "$settings" > /dev/null; then
            echo "Checkov config needs explicit roots, frameworks, local CKV IDs and disabled downloads/uploads." >&2
            exit 1
          fi
          while IFS= read -r -d "" root; do
            if [ ! -d "$root" ]; then
              echo "Missing Checkov scan directory: $root" >&2
              exit 1
            fi
          done < <(jq -j '.directory[] | ., "\u0000"' <<< "$settings")
          checkov --config-file "$config_file"
        '';
      };
      description = "Read-only Checkov scan.";
    };
  };
}
