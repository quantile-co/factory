{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.github;
in
{
  options.quantile.github = {
    gh.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.gh;
      description = "GitHub CLI.";
    };

    actionlint.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.actionlint;
      description = "GitHub Actions linter.";
    };

    actionlint.shellcheck.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.shellcheck;
      description = "ShellCheck used for embedded workflow scripts.";
    };

    actionlint.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/github/actionlint.yaml;
      description = "Actionlint configuration file.";
    };

    dependabot.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/github/dependabot.yml;
      description = "Optional Dependabot configuration template.";
    };

    actionlint.check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-actionlint";
        runtimeInputs = [ cfg.actionlint.package cfg.actionlint.shellcheck.package pkgs.findutils pkgs.git ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config_args=()
          if [ -n "''${ACTIONLINT_CONFIG_FILE:-}" ]; then
            test -f "$ACTIONLINT_CONFIG_FILE" || { echo "Missing Actionlint config: $ACTIONLINT_CONFIG_FILE" >&2; exit 1; }
            config_args=(-config-file "$ACTIONLINT_CONFIG_FILE")
          fi
          git ls-files --cached --others --exclude-standard -z -- '.github/workflows/*.yaml' '.github/workflows/*.yml' |
            xargs -0 -r actionlint -shellcheck ${lib.getExe cfg.actionlint.shellcheck.package} -pyflakes "" "''${config_args[@]}" --
        '';
      };
      description = "GitHub Actions check.";
    };
  };
}
