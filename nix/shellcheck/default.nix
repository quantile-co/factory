{ lib, pkgs, ... }:
{
  options.quantile.shellcheck.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.shellcheck;
    description = "ShellCheck CLI for shell scripts and Actionlint's embedded-script checks.";
  };
}
