{ lib, pkgs, ... }:
{
  options.quantile-co.factory.clickhouse.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.clickhouse;
    description = "Native ClickHouse package for clickhouse client; servers and connections are consumer-owned.";
  };
}
