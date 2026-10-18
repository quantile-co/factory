{ lib, pkgs, ... }:
{
  options.quantile.logs.lnav.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.lnav;
    description = "lnav log inspection CLI; consumers choose when and which logs to inspect.";
  };
}
