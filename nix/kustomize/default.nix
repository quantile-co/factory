{ lib, pkgs, ... }:
{
  options.quantile.kustomize.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.kustomize;
    description = "Kustomize CLI.";
  };
}
