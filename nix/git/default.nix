{
  config,
  lib,
  pkgs,
  ...
}:
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
    prePush = {
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "checked-git-lfs-pre-push";
          runtimeInputs = [
            cfg.package
            cfg.lfs.package
            config.quantile.prek.check.package
            pkgs.coreutils
          ];
          text = ''
            set +x
            umask 077
            work=$(mktemp -d)
            trap 'rm -rf -- "$work"' EXIT
            trap 'exit 130' INT
            trap 'exit 143' TERM
            cat > "$work/refs"
            GIT_PRE_PUSH_REFS="$work/refs" check-git-hooks
            if [ -n "''${GIT_PRE_PUSH_LEGACY:-}" ]; then
              test -x "$GIT_PRE_PUSH_LEGACY" || { echo 'Additional pre-push hook is not executable.' >&2; exit 1; }
              "$GIT_PRE_PUSH_LEGACY" "$@" < "$work/refs"
            fi
            git-lfs pre-push "$@" < "$work/refs"
          '';
        };
        description = "Run native Prek checks and an optional additional hook before uploading LFS objects.";
      };
      install.package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "install-checked-git-pre-push";
          runtimeInputs = [
            cfg.package
            pkgs.coreutils
          ];
          text = ''
            common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
            hook_dir="$common_dir/hooks"
            mkdir -p "$hook_dir"
            umask 077
            candidate=$(mktemp "$hook_dir/pre-push.XXXXXX")
            trap 'rm -f -- "$candidate"' EXIT
            cat > "$candidate" <<'HOOK'
            #!/bin/sh
            exec ${lib.getExe cfg.prePush.package} "$@"
            HOOK
            # Installation is explicit: replace only this repository's pre-push
            # hook, leaving all other hook types untouched.
            chmod 700 "$candidate"
            mv -- "$candidate" "$hook_dir/pre-push"
            # All worktrees inherit this common hook even with a global override.
            git config --local core.hooksPath "$hook_dir"
            # Retarget an override in the invoking worktree instead of leaving
            # the installed hook inactive. Other worktrees use the shared setting.
            worktree_override=$(git config --worktree --get core.hooksPath 2>/dev/null || :)
            if [ -n "$worktree_override" ] && [ "$worktree_override" != "$hook_dir" ]; then
              git config --worktree core.hooksPath "$hook_dir"
            fi
          '';
        };
        description = "Explicitly install a checked pre-push hook shared by this repository's worktrees.";
      };
    };
  };
}
