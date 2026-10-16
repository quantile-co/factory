{ config, lib, pkgs, ... }:
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

    actionlint.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../etc/github/actionlint.yaml;
      description = "Actionlint configuration file.";
    };

    actionlint.check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-actionlint";
        runtimeInputs = [ config.quantile.github.actionlint.package ];
        text = "actionlint";
      };
      description = "GitHub Actions check.";
    };
  };
}
