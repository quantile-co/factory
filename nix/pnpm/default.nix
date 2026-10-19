{ lib, pkgs, ... }:
{
  options.quantile.pnpm.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.pnpm;
    description = "pnpm CLI; consumers own package-manager invocation and lockfile policy.";
  };
}
