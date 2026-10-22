{ lib, pkgs, ... }:
{
  options.quantile-co.factory.nix.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nix;
    description = "Nix CLI.";
  };
}
