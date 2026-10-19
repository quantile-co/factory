{ lib, pkgs, ... }:
{
  options.quantile.buf.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.buf;
    description = "Buf CLI; generation is explicit.";
  };
}
