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
        description = "Run native Prek checks and an optional legacy hook before uploading LFS objects.";
      };
      install.package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.writeShellApplication {
          name = "install-checked-git-pre-push";
          runtimeInputs = [
            cfg.package
            pkgs.coreutils
            pkgs.diffutils
            pkgs.gnugrep
          ];
          text = ''
            git_dir=$(git rev-parse --path-format=absolute --git-dir)
            common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
            hook_dir="$common_dir/hooks"
            hook="$hook_dir/pre-push"
            is_managed() {
              [ -f "$1" ] && [ ! -L "$1" ] &&
              [ "$(wc -l < "$1")" -eq 2 ] &&
              [ "$(head -n 1 "$1")" = '#!/bin/sh' ] &&
              tail -n 1 "$1" | grep -Eq '^exec /nix/store/[a-z0-9]{32}-checked-git-lfs-pre-push/bin/checked-git-lfs-pre-push "\$@"$'
            }
            shared_override=$(git config --local --get core.hooksPath || :)
            if [ -n "$shared_override" ] && [ "$shared_override" != "$hook_dir" ]; then
              echo "Refusing to replace existing shared core.hooksPath: $shared_override" >&2
              exit 1
            fi
            # Do not silently install an inactive hook behind a global/system override.
            if [ -z "$shared_override" ]; then
              for scope in global system; do
                inherited=$(git config --"$scope" --get core.hooksPath || :)
                if [ -n "$inherited" ] && [ "$inherited" != "$hook_dir" ]; then
                  echo "Refusing to shadow existing $scope core.hooksPath: $inherited" >&2
                  exit 1
                fi
              done
            fi
            worktree_override=$(git config --worktree --get core.hooksPath || :)
            if [ -n "$worktree_override" ] && [ "$worktree_override" != "$hook_dir" ]; then
              if [ "$worktree_override" != "$git_dir/hooks" ] || ! is_managed "$worktree_override/pre-push"; then
                echo "Refusing to replace existing worktree core.hooksPath: $worktree_override" >&2
                exit 1
              fi
            fi
            mkdir -p "$hook_dir"
            umask 077
            candidate=$(mktemp "$hook_dir/pre-push.XXXXXX")
            trap 'rm -f -- "$candidate"' EXIT
            cat > "$candidate" <<'HOOK'
            #!/bin/sh
            exec ${lib.getExe cfg.prePush.package} "$@"
            HOOK
            if [ -e "$hook" ] || [ -L "$hook" ]; then
              if ! cmp -s "$candidate" "$hook"; then
                if ! is_managed "$hook"; then
                  echo "Refusing to replace an existing shared pre-push hook: $hook" >&2
                  exit 1
                fi
                chmod 700 "$candidate"
                mv -- "$candidate" "$hook"
              fi
            else
              chmod 700 "$candidate"
              mv -- "$candidate" "$hook"
            fi
            # A worktree-local override would shadow the shared hook. Migrate only
            # our own previous installer; leave its now-inert hook file untouched.
            if [ -n "$worktree_override" ]; then
              git config --worktree --unset core.hooksPath
            fi
          '';
        };
        description = "Explicitly install a checked pre-push hook shared by this repository's worktrees.";
      };
    };
  };
}
