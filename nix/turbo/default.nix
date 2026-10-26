{ lib, ... }:
{
  options.quantile-co.factory.turbo = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/turbo/turbo.json;
      description = "Native task-graph seed with opt-in remote build caching and uncached validation/fixes.";
    };
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        export TURBO_CACHE="''${TURBO_CACHE:-local:rw}"
      '';
      description = "Opt-in local-only Turbo cache default; preserve caller-selected CI cache access.";
    };
  };
}
