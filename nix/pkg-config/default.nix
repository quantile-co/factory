{ lib, pkgs, ... }:
{
  options.quantile.pkg-config.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.pkg-config;
    description = "pkg-config build dependency metadata CLI.";
  };
}
