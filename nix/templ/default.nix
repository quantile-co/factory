{ lib, pkgs, ... }:
{
  options.quantile-co.factory.templ.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.templ;
    description = "templ Go template generator.";
  };
}
