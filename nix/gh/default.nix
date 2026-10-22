{ lib, pkgs, ... }:
{
  options.quantile-co.factory.gh.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gh;
    description = "GitHub CLI.";
  };
}
