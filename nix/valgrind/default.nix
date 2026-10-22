{ lib, pkgs, ... }:
{
  options.quantile-co.factory.valgrind.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.valgrind;
    description = "Valgrind memory analysis tools (supported platforms only).";
  };
}
