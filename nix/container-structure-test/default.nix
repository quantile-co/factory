{ lib, pkgs, ... }:
{
  options.quantile.container-structure-test.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.container-structure-test;
    description = "Container image structure test CLI; consumers own their test configuration.";
  };
}
