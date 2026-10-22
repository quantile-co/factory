{ lib, pkgs, ... }:
{
  options.quantile-co.factory.sqlc.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.sqlc;
    description = "sqlc code generator.";
  };
}
