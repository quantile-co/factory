{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.actionlint;
in
{
  options.quantile-co.factory.actionlint = {
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
          config.quantile-co.factory.shellcheck.package
          pkgs.findutils
          pkgs.git
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          git ls-files --cached --others --exclude-standard -z -- '.github/workflows/*.yaml' '.github/workflows/*.yml' |
            xargs -0 -r actionlint -shellcheck ${lib.getExe config.quantile-co.factory.shellcheck.package} -pyflakes "" --
        '';
      };
      description = "Read-only Git-scoped GitHub Actions check with ShellCheck for embedded scripts.";
    };
  };
}
