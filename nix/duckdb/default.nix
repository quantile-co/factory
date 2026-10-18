{ lib, pkgs, ... }:
{
  options.quantile.duckdb.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.duckdb;
    description = "DuckDB CLI.";
  };
}
