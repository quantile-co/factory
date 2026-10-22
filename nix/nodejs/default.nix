{ lib, pkgs, ... }:
{
  options.quantile-co.factory.nodejs.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nodejs_24;
    description = "Node.js and npm.";
  };
}
