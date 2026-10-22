{ lib, pkgs, ... }:
{
  options.quantile-co.factory.mockery.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.go-mockery;
    description = "Mockery Go mock generator.";
  };
}
