{ lib, pkgs, ... }:
{
  options.quantile.postgresql.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.postgresql;
    description = "PostgreSQL client and server tools; consumers own database services and initialization.";
  };
}
