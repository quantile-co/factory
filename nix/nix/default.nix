{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile.nix;
  source =
    name: package: includeUntracked: command:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        package
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
  options.quantile.nix = {
    nix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nix;
      description = "Nix CLI for input checks and explicit updates.";
    };
    formatter.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nixfmt;
      description = "nixfmt CLI.";
    };
    deadnix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.deadnix;
      description = "deadnix CLI.";
    };
    statix.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.statix;
      description = "Statix CLI.";
    };
    check.format.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-nixfmt" cfg.formatter.package true ''nixfmt --check "''${selected[@]}"'';
      description = "Read-only formatting check of Git-selected Nix files.";
    };
    check.deadnix.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-deadnix" cfg.deadnix.package true ''deadnix --fail "''${selected[@]}"'';
      description = "Read-only dead-code check of Git-selected Nix files.";
    };
    check.statix.package = lib.mkOption {
      type = lib.types.package;
      default = source "check-statix" cfg.statix.package true ''
        status=0
        for file in "''${selected[@]}"; do statix check "$file" || status=1; done
        exit "$status"
      '';
      description = "Read-only Statix analysis of Git-selected Nix files.";
    };
    fix.package = lib.mkOption {
      type = lib.types.package;
      default = source "fix-nixfmt" cfg.formatter.package false ''nixfmt "''${selected[@]}"'';
      description = "Explicit nixfmt repair of selected tracked regular Nix files only.";
    };
    tools = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [
        cfg.nix.package
        cfg.formatter.package
        cfg.deadnix.package
        cfg.statix.package
      ];
      description = "Optional Nix development tools for consumer-owned shell installation.";
    };
  };
}
