{ lib, pkgs, ... }:
{
  options.quantile-co.factory.otelcol-contrib = {
    package = lib.mkOption {
      type = lib.types.package;
      default =
        (pkgs.opentelemetry-collector-releases.override {
          # The Collector's Swiss dependency does not yet support Go 1.27.
          buildGoModule = pkgs.buildGo126Module;
          go = pkgs.go_1_26;
        }).otelcol-contrib;
      description = "Upstream contrib collector from the locked Nixpkgs input; starts nothing on import.";
    };
    hostConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/config.yaml;
      description = "Native host metrics configuration with runtime-only managed credentials and agent identity.";
    };
    journalConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/journald.yaml;
      description = "Opt-in selected service journals; requires qualified existing unprivileged journal access.";
    };
    dockerConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/docker.yaml;
      description = "Explicit Docker stats overlay; socket access grants host-root authority.";
    };
  };
}
