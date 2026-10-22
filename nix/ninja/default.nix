{ lib, pkgs, ... }:
{
  options.quantile-co.factory.ninja.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.ninja;
    description = "Ninja build-system CLI.";
  };
}
