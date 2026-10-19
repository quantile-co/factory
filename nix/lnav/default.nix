{ lib, pkgs, ... }:
{
  options.quantile.lnav.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.lnav;
    description = "lnav log inspection CLI.";
  };
}
