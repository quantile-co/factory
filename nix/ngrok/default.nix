{ lib, pkgs, ... }:
{
  options.quantile-co.factory.ngrok.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.ngrok;
    description = "ngrok CLI.";
  };
}
