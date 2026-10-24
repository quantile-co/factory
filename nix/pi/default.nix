{
  lib,
  pkgs,
  llmAgents,
  ...
}:
{
  options.quantile-co.factory.pi = {
    package = lib.mkOption {
      type = lib.types.package;
      default = llmAgents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
      description = "Pi coding agent; executable updates remain Nix-owned.";
    };
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        PI_MEMORY_DIR="$(${lib.getExe pkgs.git} rev-parse --show-toplevel)" || return
        PI_MEMORY_DIR="$PI_MEMORY_DIR/.pi/memory"
        export PI_MEMORY_DIR PI_MEMORY_EXIT_SUMMARY=0
      '';
      description = "Opt-in checkout-local Pi memory environment; select in the development shell.";
    };
    settingsFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pi/settings.json;
      description = "Canonical native Pi settings; copy explicitly. The local Factory package is resolved through the consumer workspace installation.";
    };
  };
}
