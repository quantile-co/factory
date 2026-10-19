{ lib, pkgs, ... }:
{
  options.quantile.buf.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.buf;
    description = "Buf CLI; consumers own buf.yaml and buf.gen.yaml and run generation explicitly.";
  };
}
