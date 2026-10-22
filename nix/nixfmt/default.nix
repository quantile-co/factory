{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.nixfmt;
  source =
    name: includeUntracked: command:
    pkgs.writeShellApplication {
      inherit name;
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
        git ls-files --cached ${lib.optionalString includeUntracked "--others --exclude-standard"} -z -- "''${paths[@]}" > "$work"
        selected=()
        while IFS= read -r -d "" file; do
          if [ -f "$file" ] && [ ! -L "$file" ]; then selected+=("$file"); fi
        done < "$work"
        if (( ''${#selected[@]} == 0 )); then exit 0; fi
        ${command}
      '';
    };
in
{
  options.quantile-co.factory.nixfmt = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nixfmt;
      description = "nixfmt CLI.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-nixfmt" true ''nixfmt --check "''${selected[@]}"'';
      description = "Read-only formatting check of Git-selected Nix files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = source "fix-nixfmt" false ''nixfmt "''${selected[@]}"'';
      description = "Explicit nixfmt repair of selected tracked regular Nix files only.";
    };
  };
}
