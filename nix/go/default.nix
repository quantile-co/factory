{ lib, pkgs, ... }:
{
  options.quantile.go.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.go;
    description = "Go toolchain.";
  };
}
