{ lib, pkgs, ... }:
{
  options.quantile-co.factory.uv.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.uv;
    description = "uv CLI.";
  };
}
