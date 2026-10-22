{ lib, pkgs, ... }:
{
  options.quantile-co.factory.k9s.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.k9s;
    description = "k9s Kubernetes terminal UI.";
  };
}
