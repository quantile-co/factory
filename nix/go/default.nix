{ lib, pkgs, ... }:
{
  options.quantile-co.factory.go.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.go;
    description = "Go toolchain.";
  };
}
