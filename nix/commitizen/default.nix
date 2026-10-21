{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.quantile.commitizen = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.commitizen;
      description = "Commitizen CLI.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/commitizen/.cz.toml;
      description = "Native Commitizen configuration template.";
    };
    prePush.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeShellApplication {
        name = "check-commitizen-push";
        runtimeInputs = [
          config.quantile.commitizen.package
          pkgs.git
          pkgs.coreutils
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ -z "''${GIT_PRE_PUSH_REFS:-}" ]; then
            echo 'Commitizen checks pushed refs when the pre-push hook runs.' >&2
            exit 0
          fi
          test -f "$GIT_PRE_PUSH_REFS" || { echo 'Missing pre-push ref input.' >&2; exit 1; }
          work=$(mktemp -d)
          trap 'rm -rf -- "$work"' EXIT
          while read -r local_ref local_sha remote_ref remote_sha extra; do
            if [ -z "$local_ref" ] || [ -z "$remote_ref" ] || [ -n "$extra" ] ||
              [[ ! "$local_sha" =~ ^[0-9a-f]{40,64}$ ]] ||
              [[ ! "$remote_sha" =~ ^[0-9a-f]{40,64}$ ]]; then
              echo 'Invalid pre-push ref record.' >&2
              exit 1
            fi
            if [[ "$local_sha" =~ ^0+$ ]]; then continue; fi
            if [[ "$remote_sha" =~ ^0+$ ]]; then
              git rev-list "$local_sha" --not --remotes > "$work/commits"
            else
              git rev-list "$remote_sha..$local_sha" > "$work/commits"
            fi
            if [ -s "$work/commits" ]; then
              test -f .cz.toml || { echo 'Missing native Commitizen .cz.toml' >&2; exit 1; }
            fi
            while IFS= read -r commit; do
              git log -1 --format=%B "$commit" > "$work/message"
              if ! cz --config .cz.toml check --commit-msg-file "$work/message"; then
                echo "Invalid commit message in pushed revision: $commit" >&2
                exit 1
              fi
            done < "$work/commits"
          done < "$GIT_PRE_PUSH_REFS"
        '';
      };
      description = "Check commit messages.";
    };
  };
}
