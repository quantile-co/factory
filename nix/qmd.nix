{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile.qmd = {
    package = lib.mkOption {
      type = lib.types.package;
      default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.qmd;
      description = "QMD search CLI for Pi memory.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../etc/qmd/index.yml;
      description = "Optional project-local QMD configuration template.";
    };
  };
}
