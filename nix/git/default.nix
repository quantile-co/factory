{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.git;
  permalinks = pkgs.writeShellApplication {
    name = "quantile-check-permalinks";
    runtimeInputs = [ pkgs.gnugrep ];
    text = ''
      pattern="''${1:?Native Prek config must supply a GitHub permalink regex}"
      shift
      status=0
      for path in "$@"; do
        found=0
        links=$(grep -I -oE "$pattern" -- "$path") || found=$?
        if [ "$found" -gt 1 ]; then exit "$found"; fi
        if [ -n "$links" ] && printf '%s\n' "$links" | grep -vE '/(blob|tree)/[a-f0-9]{40}$' > /dev/null; then
          printf 'Non-permanent VCS link in %s; use a full commit SHA.\n' "$path" >&2
          status=1
        fi
      done
      exit "$status"
    '';
  };
  gitleaks = pkgs.writeShellApplication {
    name = "quantile-git-gitleaks";
    runtimeInputs = [ cfg.git.package cfg.gitleaks.package ];
    text = ''
      cd "$(git rev-parse --show-toplevel)"
      if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
        echo 'Full-history secret scanning requires an unshallow checkout.' >&2
        exit 1
      fi
      gitleaks git --no-banner --redact .
      gitleaks dir --no-banner --redact .
    '';
  };
in
{
  options.quantile.git = {
    git.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.git;
      description = "Git CLI.";
    };
    lfs.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.git-lfs;
      description = "Git LFS CLI.";
    };
    prek.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.prek;
      description = "Prek hook runner.";
    };
    commitizen.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.commitizen;
      description = "Commitizen CLI.";
    };
    gitleaks.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.gitleaks;
      description = "Gitleaks CLI.";
    };
    hooks.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/git/.pre-commit-config.yaml;
      description = "Native Prek hook configuration template.";
    };
    commitizen.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/git/.cz.toml;
      description = "Native Commitizen configuration template.";
    };
    hooks.tools.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.symlinkJoin {
        name = "git-hook-tools";
        paths = [ pkgs.python3Packages.pre-commit-hooks cfg.commitizen.package permalinks gitleaks ];
      };
      description = "Executables referenced by the native Prek hook template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-git-hooks";
        runtimeInputs = [ cfg.git.package cfg.prek.package cfg.hooks.tools.package ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${GIT_HOOKS_CONFIG:-.pre-commit-config.yaml}"
          test -f "$config" || { echo "Missing native Prek config: $config" >&2; exit 1; }
          prek --config "$config" run --all-files --hook-stage pre-push
        '';
      };
      description = "Read-only native pre-push checks; no LFS upload.";
    };
    prePush.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "checked-git-lfs-pre-push";
        runtimeInputs = [ cfg.git.package cfg.lfs.package cfg.check.package pkgs.coreutils ];
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
      description = "Opt-in pre-push: run checks, optional legacy hook, then upload LFS objects.";
    };
  };
}
