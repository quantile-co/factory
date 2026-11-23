{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.otelcol-contrib;
in
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
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        export QUANTILE_OTELCOL_BINARY=${lib.getExe cfg.package}
        export QUANTILE_OTELCOL_CONFIG=${cfg.hostConfigFile}
        export QUANTILE_OTELCOL_DOCKER_CONFIG=${cfg.dockerConfigFile}
        export QUANTILE_OTELCOL_JOURNAL_CONFIG=${cfg.journalConfigFile}
      '';
      description = "Expose the collector executable and configuration paths without starting it.";
    };
    hostConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/config.yaml;
      description = "Native host metrics configuration with runtime-only managed credentials and agent identity.";
    };
    journalConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/journald.yaml;
      description = "Selected Amp service journals; the non-root Collector service requires systemd-journal group access.";
    };
    dockerConfigFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/otelcol-contrib/docker.yaml;
      description = "Explicit Docker stats overlay; socket access grants host-root authority.";
    };
  };
}
