{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.actionlint;
in
{
  imports = [ ../shellcheck ];
  options.quantile.actionlint = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.actionlint;
      description = "GitHub Actions linter.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/actionlint/actionlint.yaml;
      description = "Actionlint configuration template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-actionlint";
        runtimeInputs = [
          cfg.package
          config.quantile.shellcheck.package
          pkgs.findutils
          pkgs.git
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config_args=()
          if [ -n "''${ACTIONLINT_CONFIG_FILE:-}" ]; then
            test -f "$ACTIONLINT_CONFIG_FILE" || { echo "Missing Actionlint config: $ACTIONLINT_CONFIG_FILE" >&2; exit 1; }
            config_args=(-config-file "$ACTIONLINT_CONFIG_FILE")
          fi
          git ls-files --cached --others --exclude-standard -z -- '.github/workflows/*.yaml' '.github/workflows/*.yml' |
            xargs -0 -r actionlint -shellcheck ${lib.getExe config.quantile.shellcheck.package} -pyflakes "" "''${config_args[@]}" --
        '';
      };
      description = "Read-only Git-scoped GitHub Actions check with ShellCheck for embedded scripts.";
    };
  };
}
