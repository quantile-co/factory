{ lib, pkgs, ... }:
{
  options.quantile.meson.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.meson;
    description = "Meson build-system CLI.";
  };
}
