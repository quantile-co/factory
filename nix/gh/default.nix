{ lib, pkgs, ... }:
{
  options.quantile.gh.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.gh;
    description = "GitHub CLI; authentication and workflow execution remain consumer-owned.";
  };
}
