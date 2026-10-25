{ lib, ... }:
{
  options.quantile-co.factory.turbo.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/turbo/turbo.json;
    description = "Native task-graph seed with opt-in remote build caching and uncached validation/fixes.";
  };
}
