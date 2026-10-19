{ lib, pkgs, ... }:
{
  options.quantile.gofumpt.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gofumpt;
    description = "gofumpt formatter; the golangci-lint check uses this selected package.";
  };
}
