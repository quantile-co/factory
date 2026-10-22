{ lib, pkgs, ... }:
{
  options.quantile-co.factory.bear.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.bear;
    description = "Bear compilation database generator.";
  };
}
