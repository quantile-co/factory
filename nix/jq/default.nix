{ lib, pkgs, ... }:
{
  options.quantile.jq.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.jq;
    description = "jq for consumer-owned JSON processing; validation with Prek is separate.";
  };
}
