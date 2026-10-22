{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.deadnix;
in
{
  options.quantile-co.factory.deadnix = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.deadnix;
      description = "deadnix CLI.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-deadnix";
        runtimeInputs = [
          cfg.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          paths=("$@")
          if (( ''${#paths[@]} == 0 )); then paths=( '*.nix' ); fi
          work=$(mktemp)
          trap 'rm -f -- "$work"' EXIT
          git ls-files --cached --others --exclude-standard -z -- "''${paths[@]}" > "$work"
          selected=()
          while IFS= read -r -d "" file; do
            if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
          done < "$work"
          if (( ''${#selected[@]} == 0 )); then exit 0; fi
          deadnix --fail "''${selected[@]}"
        '';
      };
      description = "Read-only dead-code check of Git-selected Nix files.";
    };
  };
}
