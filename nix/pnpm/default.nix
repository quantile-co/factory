{ lib, pkgs, ... }:
{
  options.quantile-co.factory.pnpm.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.pnpm;
    description = "pnpm CLI.";
  };
}
