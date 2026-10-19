{ lib, pkgs, ... }:
{
  options.quantile.nix.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nix;
    description = "Nix CLI; flake input checks and updates are consumer-owned.";
  };
}
