{ lib, pkgs, ... }:
{
  options.quantile.ngrok.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.ngrok;
    description = "ngrok CLI; consumers explicitly permit its unfree license and configure authentication.";
  };
}
