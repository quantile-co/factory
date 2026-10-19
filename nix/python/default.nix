{ lib, pkgs, ... }:
{
  options.quantile.python.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.python3;
    description = "Selected Python interpreter; Ruff and mypy derive their target version from it.";
  };
}
