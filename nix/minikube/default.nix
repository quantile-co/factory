{ lib, pkgs, ... }:
{
  options.quantile-co.factory.minikube.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.minikube;
    description = "Minikube CLI.";
  };
}
