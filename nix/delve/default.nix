{ lib, pkgs, ... }:
{
  options.quantile.delve.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.delve;
    description = "Delve Go debugger.";
  };
}
