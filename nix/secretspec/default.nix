{ devenvCli }:
{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.secretspec;
  cli = devenvCli.packages.${pkgs.stdenv.hostPlatform.system}.default;
in
{
  options.quantile.secretspec = {
    package = lib.mkOption {
      type = lib.types.package;
      # Expose only SecretSpec from the pinned Devenv CLI.
      default = pkgs.runCommand "secretspec" { meta.mainProgram = "secretspec"; } ''
        mkdir -p "$out/bin"
        ln -s ${lib.getExe' cli "secretspec"} "$out/bin/secretspec"
      '';
      description = "SecretSpec CLI.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/secretspec/secretspec.toml;
      description = "SecretSpec manifest template.";
    };

    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        __factory_load_secrets() {
          local __factory_exports __factory_status=0 __factory_xtrace=0
          case $- in *x*) __factory_xtrace=1; set +x ;; esac
          __factory_exports="$(${lib.getExe cfg.package} export --format shell)" || __factory_status=$?
          if [ "$__factory_status" -eq 0 ]; then
            eval "$__factory_exports" || __factory_status=$?
          fi
          unset __factory_exports
          if [ "$__factory_xtrace" -eq 1 ]; then set -x; fi
          return "$__factory_status"
        }
        __factory_load_secrets || exit $?
        unset -f __factory_load_secrets
      '';
      description = ''
        Opt-in Bash runtime loader for the consumer's native SecretSpec manifest.
        The manifest must exist before shell capture; SECRETSPEC_FILE can select its native source.
        Exports to this shell and its children;
        does not isolate ambient credentials or manage as_path file lifetimes.
        Never put resolved values in Nix env attributes.
      '';
    };
  };
}
