{ config, lib, pkgs, ... }:
{
  options.quantile.semgrep = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.semgrep;
      description = "Semgrep CLI.";
    };

    rulesDir = lib.mkOption {
      type = lib.types.path;
      default = ../etc/semgrep;
      description = "Semgrep rules directory.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-semgrep";
        runtimeInputs = [ config.quantile.semgrep.package ];
        text = ''
          export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
          rules="''${SEMGREP_RULES_DIR:-.semgrep}"
          semgrep --test "$rules" --metrics off
          excludes=(--exclude "$rules/**")
          if [ -n "''${SEMGREP_FIXTURES_DIR:-}" ]; then
            excludes+=(--exclude "$SEMGREP_FIXTURES_DIR/**")
          fi
          semgrep scan --config "$rules" "''${excludes[@]}" --metrics off \
            --error --strict --scan-unknown-extensions --quiet .
        '';
      };
      description = "Semgrep check.";
    };
  };
}
