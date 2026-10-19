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
      default = ../../etc/semgrep/rules;
      description = "Semgrep rules directory.";
    };

    ignoreFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/semgrep/.semgrepignore;
      description = "Semgrep ignore template.";
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
          semgrep scan --config "$rules" --metrics off \
            --error --strict --scan-unknown-extensions --quiet .
        '';
      };
      description = "Test local rules and scan the working tree with metrics disabled.";
    };
  };
}
