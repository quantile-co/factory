{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.opentelemetry;
in
{
  options.quantile-co.factory.opentelemetry = {
    collectorPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.opentelemetry-collector-contrib;
      description = "Pinned native collector; importing the module starts nothing.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/opentelemetry/collector.yaml;
      description = "Native host-metrics pipeline with runtime-only managed OTLP credentials.";
    };
    dockerConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/opentelemetry/docker.yaml;
      description = "Explicit Docker stats overlay; socket access grants host-root authority.";
    };
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "factory-otelcol";
        text = ''
          exec ${lib.getExe pkgs.nodejs_24} --input-type=module -e '
            import { runCollector } from "${../../packages/namespace/src/collector.ts}";
            runCollector("${lib.getExe cfg.collectorPackage}", "${cfg.configFile}", "${cfg.dockerConfigFile}", process.argv.slice(1));
          ' -- "$@"
        '';
      };
      description = "Opt-in foreground agent; validates runtime credentials and bounds shutdown without persisting secrets.";
    };
  };
}
