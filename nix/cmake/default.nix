{ lib, pkgs, ... }:
{
  options.quantile-co.factory.cmake.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.cmake;
    description = "CMake build-system CLI.";
  };
}
