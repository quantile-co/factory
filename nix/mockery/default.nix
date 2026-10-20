{ lib, pkgs, ... }:
{
  options.quantile.mockery.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.go-mockery;
    description = "Mockery Go mock generator.";
  };
}
