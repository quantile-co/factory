{ lib, pkgs, ... }:
{
  options.quantile.ts = {
    node.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nodejs_24;
      description = "Node.js for TypeScript tooling.";
    };

    biome.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/biome/default.json;
      description = "Biome configuration template; the project pins Biome in package.json.";
    };

    pnpm.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.pnpm;
      description = "pnpm for project dependencies.";
    };
  };
}
