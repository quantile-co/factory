{ lib, pkgs, ... }:
{
  options.quantile-co.factory.coreutils.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.coreutils;
    description = "GNU core utilities.";
  };
}
