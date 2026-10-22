{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.statix;
in
{
  options.quantile-co.factory.statix = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.statix;
      description = "Statix CLI.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-statix";
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
          status=0
          for file in "''${selected[@]}"; do statix check "$file" || status=1; done
          exit "$status"
        '';
      };
      description = "Read-only Statix analysis of Git-selected Nix files.";
    };
  };
}
