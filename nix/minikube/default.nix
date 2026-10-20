{ lib, pkgs, ... }:
{
  options.quantile.minikube.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.minikube;
    description = "Minikube CLI.";
  };
}
