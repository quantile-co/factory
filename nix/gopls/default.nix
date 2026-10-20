{ lib, pkgs, ... }:
{
  options.quantile.gopls.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gopls;
    description = "Go language server.";
  };
}
