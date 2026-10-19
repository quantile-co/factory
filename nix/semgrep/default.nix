{
  config,
  lib,
  pkgs,
  ...
}:
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

    test.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "test-semgrep";
        runtimeInputs = [
          config.quantile.semgrep.package
          pkgs.jq
        ];
        text = ''
          set -euo pipefail
          export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
          rules="''${SEMGREP_RULES_DIR:-.semgrep}"
          tests="''${SEMGREP_TESTS_DIR:-$rules}"
          test -e "$rules" && test -e "$tests" || { echo 'Semgrep rules or fixtures not found.' >&2; exit 1; }
          results=$(semgrep --test "$tests" --config "$rules" --metrics off --json) || {
            printf '%s\n' "$results" >&2
            echo 'Semgrep rule tests failed.' >&2
            exit 1
          }
          printf '%s\n' "$results" |
            jq -er 'if ([.results[].checks[]] | length) == 0 then error("No Semgrep rule tests selected.") elif all(.results[].checks[]; .passed) then "Semgrep rule tests passed." else error("Semgrep rule tests failed.") end'
        '';
      };
      description = "Run selected rule fixtures; SEMGREP_TESTS_DIR can select a separate directory.";
    };

    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-semgrep";
        runtimeInputs = [ config.quantile.semgrep.package ];
        text = ''
          set -euo pipefail
          export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
          rules="''${SEMGREP_RULES_DIR:-.semgrep}"
          test -e "$rules" || { echo 'Semgrep rules not found.' >&2; exit 1; }
          if [ "$#" -eq 0 ]; then set -- .; fi
          semgrep scan --config "$rules" --metrics off \
            --error --strict --scan-unknown-extensions --quiet -- "$@"
        '';
      };
      description = "Scan selected source with local rules and native ignore policy.";
    };
  };
}
