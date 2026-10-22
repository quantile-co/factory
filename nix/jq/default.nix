{ lib, pkgs, ... }:
{
  options.quantile-co.factory.jq.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.jq;
    description = "jq CLI.";
  };
}
