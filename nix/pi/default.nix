{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile.pi = {
    package = lib.mkOption {
      type = lib.types.package;
      default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
      description = "Pi coding agent.";
    };

    resourcesDir = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi;
      description = "Pi resources directory.";
    };

    settingsFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi/settings.json;
      description = "Pi settings file.";
    };

    skillsDir = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi/skills;
      description = "Factory skills for consumer placement.";
    };
  };
}
