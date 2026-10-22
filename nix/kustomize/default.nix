{ lib, pkgs, ... }:
{
  options.quantile-co.factory.kustomize.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.kustomize;
    description = "Kustomize CLI.";
  };
}
