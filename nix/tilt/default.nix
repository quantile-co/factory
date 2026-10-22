{ lib, pkgs, ... }:
{
  options.quantile-co.factory.tilt.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.tilt;
    description = "Tilt CLI.";
  };
}
