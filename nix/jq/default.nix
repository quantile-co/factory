{ lib, pkgs, ... }:
{
  options.quantile.jq.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.jq;
    description = "jq CLI.";
  };
}
