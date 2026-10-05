{ lib, pkgs, ... }:
{
  options.quantile.gcp.gcloud.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.google-cloud-sdk;
    description = "Google Cloud CLI for operator-run project bootstrap.";
  };
}
