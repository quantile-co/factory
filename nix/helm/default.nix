{ lib, pkgs, ... }:
{
  options.quantile.helm.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.kubernetes-helm;
    description = "Helm CLI.";
  };
}
