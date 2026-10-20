{ lib, pkgs, ... }:
{
  options.quantile.coreutils.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.coreutils;
    description = "GNU core utilities.";
  };
}
