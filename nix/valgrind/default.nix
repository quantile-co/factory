{ lib, pkgs, ... }:
{
  options.quantile.valgrind.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.valgrind;
    description = "Valgrind memory analysis tools (supported platforms only).";
  };
}
