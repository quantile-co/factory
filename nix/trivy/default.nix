{ lib, pkgs, ... }:
{
  options.quantile.trivy.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.trivy;
    description = "Trivy CLI; consumers explicitly select scan inputs and configuration.";
  };
}
