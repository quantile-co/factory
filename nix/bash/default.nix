{ lib, pkgs, ... }:
{
  options.quantile.bash.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.bash;
    description = "Bash shell.";
  };
}
