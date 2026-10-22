{ lib, pkgs, ... }:
{
  options.quantile-co.factory.buf.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.buf;
    description = "Buf CLI; generation is explicit.";
  };
}
