{ config, lib, pkgs, ... }:
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
        runtimeInputs = [ pkgs.git cfg.package ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
            echo 'Full-history secret scanning requires an unshallow checkout.' >&2
            exit 1
          fi
          gitleaks git --no-banner --redact .
          gitleaks dir --no-banner --redact .
        '';
      };
      description = "Read-only full-history and directory secret scan; rejects shallow checkouts.";
    };
  };
}
