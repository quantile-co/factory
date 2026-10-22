{ lib, pkgs, ... }:
{
  options.quantile-co.factory.age.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.age;
    description = "Age encryption CLI for consumer-selected local operations.";
  };
}
