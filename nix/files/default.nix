{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.files;
  manifest = pkgs.writeText "factory-files.json" (
    builtins.toJSON (
      builtins.mapAttrs (_: file: {
        inherit (file) mode;
        source = "${file.source}";
      }) cfg.entries
    )
  );
in
{
  options.quantile-co.factory.files = {
    entries = lib.mkOption {
      type = lib.types.attrsOf (
        lib.types.submodule {
          options = {
            source = lib.mkOption {
              type = lib.types.path;
              description = "Store-backed file or directory source.";
            };
            mode = lib.mkOption {
              type = lib.types.enum [
                "copy"
                "seed"
              ];
              description = "Exact copy or repository-owned seed.";
            };
          };
        }
      );
      default = { };
      description = "Explicit native destinations, sources and ownership modes.";
    };
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        (
          root="$(${lib.getExe pkgs.git} rev-parse --show-toplevel)" || exit
          cd "$root" || exit
          ${lib.getExe cfg.package} write
        ) || return
      '';
      description = "Opt-in managed-file reconciliation from the runtime checkout root.";
    };
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "factory-files";
        runtimeInputs = [
          pkgs.git
          pkgs.nodejs_24
        ];
        text = ''
          exec node --input-type=module - "$@" ${manifest} <<'JS'
          import { readFileSync } from "node:fs";
          import { manageFiles } from "${../../packages/nix/src/files.ts}";

          try {
            const [action, manifest] = process.argv.slice(2);
            if (!manifest || process.argv.length !== 4)
              throw new Error("Usage: factory-files write|check");
            manageFiles(process.cwd(), JSON.parse(readFileSync(manifest, "utf8")), action);
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
          }
          JS
        '';
      };
      description = "Self-contained managed-file CLI; bootstrap does not require node_modules.";
    };
  };
}
