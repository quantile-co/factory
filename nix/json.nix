{ lib, pkgs, ... }:
{
  options.quantile.json.jq.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.jq;
    description = "jq for inspecting JSON configuration and bootstrap IAM policies.";
  };
}
