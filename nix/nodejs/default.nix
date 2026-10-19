{ lib, pkgs, ... }:
{
  options.quantile.nodejs.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nodejs_24;
    description = "Node.js and npm; consumers choose when to install dependencies.";
  };
}
