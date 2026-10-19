{ lib, pkgs, ... }:
{
  options.quantile.pnpm.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.pnpm;
    description = "pnpm CLI.";
  };
}
