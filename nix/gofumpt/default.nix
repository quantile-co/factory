{ lib, pkgs, ... }:
{
  options.quantile.gofumpt.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gofumpt;
    description = "gofumpt formatter, also used by the Go check/fix executables.";
  };
}
