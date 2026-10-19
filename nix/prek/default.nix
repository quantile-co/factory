{ config, lib, pkgs, ... }:
let
  cfg = config.quantile.prek;
  permalinks = pkgs.writeShellApplication {
    name = "check-github-permalinks";
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
in
{
  imports = [ ../commitizen ../gitleaks ];
  options.quantile.prek = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.prek;
      description = "Prek hook runner.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/prek/.pre-commit-config.yaml;
      description = "Prek hook configuration template.";
    };
    withPrePush = lib.mkOption {
      type = lib.types.functionTo lib.types.path;
      default = ids:
        let
          selected =
            if builtins.isList ids && lib.all builtins.isString ids then
              lib.unique ids
            else
              throw "prek.withPrePush expects a list of hook IDs";
        in
        pkgs.runCommand "pre-commit-config.yaml" { nativeBuildInputs = [ pkgs.yq-go ]; } ''
          set -euo pipefail
          cp -- "${cfg.configFile}" "$out"
          chmod u+w "$out"
          ${lib.concatMapStringsSep "\n" (id: ''
            export HOOK_ID=${lib.escapeShellArg id}
            count=$(yq -r '[.repos[].hooks[] | select(.id == strenv(HOOK_ID))] | length' "$out")
            if [ "$count" != 1 ]; then
              echo "Expected one native Prek hook with ID $HOOK_ID, found $count." >&2
              exit 1
            fi
            entry=$(yq -r '.repos[].hooks[] | select(.id == strenv(HOOK_ID)) | .entry' "$out")
            case "$HOOK_ID" in *-fix) echo "Fix hooks must stay manual: $HOOK_ID" >&2; exit 1 ;; esac
            case "$entry" in *'--mode fix'*) echo "Fix hooks must stay manual: $HOOK_ID" >&2; exit 1 ;; esac
            if yq -e '.repos[].hooks[] | select(.id == strenv(HOOK_ID)) | .stages | contains(["pre-push"])' "$out" > /dev/null; then
              :
            elif yq -e '.repos[].hooks[] | select(.id == strenv(HOOK_ID)) | select((.stages | length) == 0) | .id' "$out" > /dev/null &&
                 yq -e '.default_stages | contains(["pre-push"])' "$out" > /dev/null; then
              :
            elif yq -e '.repos[].hooks[] | select(.id == strenv(HOOK_ID)) | select((.stages | length) == 1 and (.stages | contains(["manual"]))) | .id' "$out" > /dev/null; then
              yq -i '(.repos[].hooks[] | select(.id == strenv(HOOK_ID))).stages = ["pre-push"]' "$out"
            else
              echo "Only manual checks can be enabled for pre-push: $HOOK_ID" >&2
              exit 1
            fi
          '') selected}
        '';
      description = "Enable selected manual checks at pre-push; fixes stay manual.";
    };
    tools.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.symlinkJoin {
        name = "git-hook-tools";
        paths = [ pkgs.python3Packages.pre-commit-hooks config.quantile.commitizen.package permalinks config.quantile.gitleaks.check.package ];
      };
      description = "Executables referenced by the native Prek hook template.";
    };
    check.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-git-hooks";
        runtimeInputs = [ pkgs.git cfg.package cfg.tools.package ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${GIT_HOOKS_CONFIG:-.pre-commit-config.yaml}"
          test -f "$config" || { echo "Missing native Prek config: $config" >&2; exit 1; }
          prek --config "$config" run --all-files --hook-stage pre-push
        '';
      };
      description = "Run Prek pre-push checks without uploading LFS objects.";
    };
    checkJson.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-json";
        runtimeInputs = [ cfg.package pkgs.python3Packages.pre-commit-hooks pkgs.git ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          config="''${GIT_HOOKS_CONFIG:-.pre-commit-config.yaml}"
          test -f "$config" || { echo "Missing native Prek config: $config" >&2; exit 1; }
          prek --config "$config" run check-json --all-files --hook-stage pre-push
        '';
      };
      description = "Read-only strict JSON validation from the consumer's Prek configuration.";
    };
  };
}
