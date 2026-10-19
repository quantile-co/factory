{ lib, pkgs, ... }:
{
  options.quantile.gdb.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gdb;
    description = "GDB debugger (supported platforms only).";
  };
}
