{ devenvCli }:
{
  config,
  lib,
  pkgs,
  ...
}:
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
      # SecretSpec deliberately treats an empty env value as present, not missing:
      # https://github.com/cachix/secretspec/blob/eeb18456ca55f54e358ac1ae6a2b0be3e13af745/docs/src/content/docs/providers/env.md#L6-L7
      # EnvProvider::get maps var_os Some("") to Some(SecretBytes), without a length check:
      # https://github.com/cachix/secretspec/blob/eeb18456ca55f54e358ac1ae6a2b0be3e13af745/secretspec/src/provider/env.rs#L165-L168
      # Factory additionally requires nonempty strings. Use the native value-free
      # report for effective requiredness (profiles, defaults, extends and scopes),
      # rather than maintaining a second manifest parser or tool-specific lists.
      default = ''
        __factory_load_secrets() {
          local __factory_exports __factory_required __factory_name
          local __factory_status=0 __factory_xtrace=0
          case $- in *x*) __factory_xtrace=1; set +x ;; esac
          __factory_exports="$(${lib.getExe cfg.package} export --format shell)" || __factory_status=$?
          if [ "$__factory_status" -eq 0 ]; then
            __factory_required="$(
              set -o pipefail
              ${lib.getExe cfg.package} check --json |
                ${lib.getExe pkgs.jq} -r '.secrets[] | select(.required) | .name'
            )" || __factory_status=$?
          fi
          if [ "$__factory_status" -eq 0 ]; then
            eval "$__factory_exports" || __factory_status=$?
          fi
          if [ "$__factory_status" -eq 0 ]; then
            while IFS= read -r __factory_name; do
              [ -n "$__factory_name" ] || continue
              if [ -z "''${!__factory_name-}" ]; then
                printf 'Required SecretSpec secret is empty: %s\n' "$__factory_name" >&2
                __factory_status=1
              fi
            done <<< "$__factory_required"
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
        Exports to this shell and its children, rejecting empty required values.
        Export and the value-free report each resolve the selected secrets at runtime;
        does not isolate ambient credentials or manage as_path file lifetimes.
        Never put resolved values in Nix env attributes.
      '';
    };
  };
}
