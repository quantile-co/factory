{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.git;
in
{
  imports = [ ../prek ];
  options.quantile.git = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.git;
      description = "Git CLI.";
    };
    lfs.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.git-lfs;
      description = "Git LFS companion CLI for checked pre-push sequencing.";
    };
    prePush.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "checked-git-lfs-pre-push";
        runtimeInputs = [ cfg.package cfg.lfs.package config.quantile.prek.check.package pkgs.coreutils ];
        text = ''
          set +x
          umask 077
          work=$(mktemp -d)
          trap 'rm -rf -- "$work"' EXIT
          trap 'exit 130' INT
          trap 'exit 143' TERM
          cat > "$work/refs"
          check-git-hooks < "$work/refs"
          if [ -n "''${GIT_PRE_PUSH_LEGACY:-}" ]; then
            test -x "$GIT_PRE_PUSH_LEGACY" || { echo 'Legacy hook is not executable.' >&2; exit 1; }
            "$GIT_PRE_PUSH_LEGACY" "$@" < "$work/refs"
          fi
          git-lfs pre-push "$@" < "$work/refs"
        '';
      };
      description = "Opt-in pre-push: run Prek checks, optional legacy hook, then upload LFS objects.";
    };
  };
}
