{ lib, pkgs, ... }:
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
  };
}
