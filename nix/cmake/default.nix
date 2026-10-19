{ lib, pkgs, ... }:
{
  options.quantile.cmake.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.cmake;
    description = "CMake build-system CLI.";
  };
}
