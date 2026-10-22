{ lib, pkgs, ... }:
{
  options.quantile-co.factory.bash.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.bash;
    description = "Bash shell.";
  };
}
