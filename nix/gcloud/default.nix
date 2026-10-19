{ lib, pkgs, ... }:
{
  options.quantile.gcloud.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.google-cloud-sdk;
    description = "Google Cloud CLI.";
  };
}
