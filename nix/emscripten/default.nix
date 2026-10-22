{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.emscripten;
in
{
  options.quantile-co.factory.emscripten = {
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
          if [ -z "''${EMSCRIPTEN_STATE_DIR:-}" ] || [ "$#" -eq 0 ]; then
            echo 'Set EMSCRIPTEN_STATE_DIR and pass an explicit Emscripten command' >&2
            exit 1
          fi
          export EM_CACHE="$EMSCRIPTEN_STATE_DIR/emscripten-cache"
          mkdir -p "$EM_CACHE"
          exec "$@"
        '';
      };
      description = "Opt-in command runner with a writable Emscripten cache under EMSCRIPTEN_STATE_DIR.";
    };
  };
}
