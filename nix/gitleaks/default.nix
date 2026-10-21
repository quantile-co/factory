{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.gitleaks;
in
{
  options.quantile.gitleaks = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.gitleaks;
      description = "Gitleaks CLI.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-gitleaks";
        runtimeInputs = [
          pkgs.git
          pkgs.coreutils
          cfg.package
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
            echo 'Full-history secret scanning requires an unshallow checkout.' >&2
            exit 1
          fi
          gitleaks git --no-banner --redact .
          # Scan current source bytes, including untracked files, but not ignored
          # dependencies, local credentials or targets of generated symlinks.
          umask 077
          snapshot=$(mktemp -d)
          trap 'rm -rf -- "$snapshot"' EXIT
          git ls-files -z --cached --others --exclude-standard > "$snapshot/paths"
          mkdir "$snapshot/source"
          while IFS= read -r -d "" path; do
            if [ -f "$path" ] && [ ! -L "$path" ]; then
              cp --parents -- "$path" "$snapshot/source/"
            fi
          done < "$snapshot/paths"
          gitleaks dir --no-banner --redact "$snapshot/source"
        '';
      };
      description = "Scan history and source for secrets.";
    };
  };
}
