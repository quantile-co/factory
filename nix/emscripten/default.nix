{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.emscripten;
in
{
  options.quantile.emscripten = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.emscripten;
      description = "Optional Emscripten compiler for consumer-selected builds.";
    };

    cache.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "with-emscripten-cache";
        runtimeInputs = [
          cfg.package
          pkgs.coreutils
        ];
        text = ''
          if [ -z "''${DEVENV_STATE:-}" ] || [ "$#" -eq 0 ]; then
            echo 'Set DEVENV_STATE and pass an explicit Emscripten command' >&2
            exit 1
          fi
          export EM_CACHE="$DEVENV_STATE/emscripten-cache"
          mkdir -p "$EM_CACHE"
          exec "$@"
        '';
      };
      description = "Opt-in command runner with a writable Emscripten cache under DEVENV_STATE.";
    };
  };
}
