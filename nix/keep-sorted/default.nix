{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.keep-sorted;
  hook =
    mode:
    pkgs.writeShellApplication {
      name = if mode == "lint" then "check-keep-sorted" else "fix-keep-sorted";
      runtimeInputs = [
        cfg.package
        config.quantile-co.factory.prek.package
        pkgs.git
        pkgs.yq-go
      ];
      text = ''
        cd "$(git rev-parse --show-toplevel)"
        config="''${PREK_CONFIG_FILE:-.pre-commit-config.yaml}"
        test -f "$config" || { echo "Missing native Prek config: $config" >&2; exit 1; }
        # Prek can report a skipped hook as success. Require the selected native stage.
        if ! yq -e '.repos[].hooks[] | select(.id == "${
          if mode == "lint" then "keep-sorted" else "keep-sorted-fix"
        }" and (.stages | contains(["${
          if mode == "lint" then "pre-push" else "manual"
        }"])))' "$config" > /dev/null; then
          echo 'Native Prek config must enable the selected keep-sorted hook at its expected stage.' >&2
          exit 1
        fi
        ${
          if mode == "lint" then
            ''
              prek --config "$config" run keep-sorted --all-files --stage pre-push
            ''
          else
            ''
              if prek --config "$config" run keep-sorted-fix --all-files --stage manual; then
                exit 0
              else
                status=$?
                if [ "$status" -ne 1 ]; then exit "$status"; fi
              fi
              # Prek reports rewrites as failures; only a clean second pass succeeds.
              prek --config "$config" run keep-sorted-fix --all-files --stage manual
            ''
        }
      '';
    };
in
{
  imports = [ ../prek ];
  options.quantile-co.factory.keep-sorted = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.keep-sorted;
      description = "keep-sorted CLI; sorting options belong in source annotations.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = hook "lint";
      description = "Read-only annotated-block sorting check from the consumer's native Prek config.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = hook "fix";
      description = "Explicit scoped annotated-block sorting fix from the consumer's native Prek config.";
    };
  };
}
