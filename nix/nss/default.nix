{ lib, pkgs, ... }:
{
  options.quantile-co.factory.nss.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nssTools;
    description = "NSS certificate utilities (tools output).";
  };
}
