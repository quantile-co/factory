{ lib, pkgs, ... }:
{
  options.quantile.nss.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nssTools;
    description = "NSS certificate utilities; consumers own certificate database creation.";
  };
}
