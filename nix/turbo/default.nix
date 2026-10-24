{ lib, ... }:
{
  options.quantile-co.factory.turbo.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/turbo/turbo.json;
    description = "Native task-graph seed with local builds and uncached validation/fixes.";
  };
}
