{ lib, pkgs, ... }:
{
  options.quantile.postgres = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.postgresql;
      description = "PostgreSQL client and server tools; consumers own database services and initialization.";
    };
    nss.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nssTools;
      description = "NSS certificate utilities; consumers own certificate database creation.";
    };
  };
}
