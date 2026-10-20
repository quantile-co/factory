{ lib, pkgs, ... }:
{
  options.quantile.diffutils.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.diffutils;
    description = "GNU file comparison utilities.";
  };
}
