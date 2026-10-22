{ lib, pkgs, ... }:
{
  options.quantile-co.factory.meson.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.meson;
    description = "Meson build-system CLI.";
  };
}
