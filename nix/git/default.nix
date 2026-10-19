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
            hook_dir="$git_dir/hooks"
            hook="$hook_dir/pre-push"
            active=$(git config --get core.hooksPath || :)
            if [ -n "$active" ] && [ "$active" != "$hook_dir" ]; then
              echo "Refusing to replace existing core.hooksPath: $active" >&2
              exit 1
            fi
            previous=$(git rev-parse --git-path hooks/pre-push)
            if [ "$previous" != "$hook" ] && { [ -e "$previous" ] || [ -L "$previous" ]; }; then
              echo "Review the existing shared pre-push hook before installing: $previous" >&2
              exit 1
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
                # Upgrade only a complete two-line hook from this installer;
                # refuse custom hooks, added commands, and symlinks.
                if [ -L "$hook" ] || [ ! -f "$hook" ] ||
                  [ "$(wc -l < "$hook")" -ne 2 ] ||
                  [ "$(head -n 1 "$hook")" != '#!/bin/sh' ] ||
                  ! tail -n 1 "$hook" | grep -Eq '^exec /nix/store/[a-z0-9]{32}-checked-git-lfs-pre-push/bin/checked-git-lfs-pre-push "\$@"$'; then
                  echo "Refusing to replace an existing pre-push hook: $hook" >&2
                  exit 1
                fi
                chmod 700 "$candidate"
                mv -- "$candidate" "$hook"
              fi
            else
              chmod 700 "$candidate"
              mv -- "$candidate" "$hook"
            fi
            git config --local extensions.worktreeConfig true
            git config --worktree core.hooksPath "$hook_dir"
          '';
        };
        description = "Explicitly install the checked pre-push hook for this worktree only.";
      };
    };
  };
}
