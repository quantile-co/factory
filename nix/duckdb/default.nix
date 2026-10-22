{ lib, pkgs, ... }:
{
  options.quantile-co.factory.duckdb.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.duckdb;
    description = "DuckDB CLI.";
  };
}
