{ lib, pkgs, ... }:
{
  options.quantile.tilt.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.tilt;
    description = "Tilt CLI.";
  };
}
