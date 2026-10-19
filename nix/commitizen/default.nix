{ lib, pkgs, ... }:
{
  options.quantile.commitizen = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.commitizen;
      description = "Commitizen CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/commitizen/.cz.toml;
      description = "Native Commitizen configuration template.";
    };
  };
}
