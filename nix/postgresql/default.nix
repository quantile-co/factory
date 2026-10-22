{ lib, pkgs, ... }:
{
  options.quantile-co.factory.postgresql.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.postgresql;
    description = "PostgreSQL client and server tools.";
  };
}
