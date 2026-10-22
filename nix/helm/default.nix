{ lib, pkgs, ... }:
{
  options.quantile-co.factory.helm.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.kubernetes-helm;
    description = "Helm CLI.";
  };
}
