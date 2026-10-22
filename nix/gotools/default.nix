{ lib, pkgs, ... }:
{
  options.quantile-co.factory.gotools.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gotools;
    description = "Go development tools, including goimports and stringer.";
  };
}
