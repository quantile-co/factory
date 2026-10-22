{ lib, pkgs, ... }:
{
  options.quantile-co.factory.gcloud.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.google-cloud-sdk;
    description = "Google Cloud CLI.";
  };
}
