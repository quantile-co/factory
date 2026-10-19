{ lib, ... }:
{
  options.quantile.biome.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/biome/default.json;
    description = "Biome configuration template; callers select the CLI.";
  };
}
