{ lib, pkgs, ... }:
{
  options.quantile.uv.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.uv;
    description = "uv CLI; installing it does not sync project dependencies.";
  };
}
