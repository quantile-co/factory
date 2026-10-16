{ lib, pkgs, ... }:
{
  options.quantile.ts.node.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.nodejs_24;
    description = "Node.js with npm.";
  };
}
