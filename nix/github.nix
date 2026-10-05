{ lib, pkgs, ... }:
{
  options.quantile.github.gh.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gh;
    description = "GitHub CLI for operator-run repository bootstrap.";
  };
}
