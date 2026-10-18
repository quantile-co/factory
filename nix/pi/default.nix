{ llmAgents }:
{ lib, pkgs, ... }:
{
  options.quantile.pi = {
    package = lib.mkOption {
      type = lib.types.package;
      default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
      description = "Pi coding agent.";
    };

    npm.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nodejs_24;
      description = "Node.js with npm for Pi packages.";
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
  };
}
