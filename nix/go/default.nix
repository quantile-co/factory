{ lib, pkgs, ... }:
{
  options.quantile.go.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.go;
    description = "Pinned Go toolchain; consumers explicitly select the version.";
  };
}
