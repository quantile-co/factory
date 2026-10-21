{ inputs }:
if inputs.devenv.rev != inputs.devenv-cli.rev then
  throw "The Devenv CLI and module inputs must use the same revision"
else
  {
    nixModules.devenv.files =
      {
        config,
        lib,
        pkgs,
        ...
      }:
      let
        links = lib.filterAttrs (_: file: file.copyMode == "symlink") config.files;
      in
      {
        tasks."files:prepare-directory-links" = lib.mkIf (links != { }) {
          after = [ "devenv:files:cleanup" ];
          before = [ "devenv:files" ];
          # Devenv's ln -sf follows existing directory links into the read-only store:
          # https://github.com/cachix/devenv/blob/a86a087d250cbae59adb95627bc4aa3069a87e6c/src/modules/files.nix#L110-L126
          # Report: https://github.com/higherorderfunctor/nix-agentic-tools/issues/2229
          exec = ''
            set -euo pipefail
            export PATH="${
              lib.makeBinPath [
                pkgs.coreutils
                pkgs.jq
              ]
            }:$PATH"
            cd ${lib.escapeShellArg config.devenv.root}

            prepare_link() {
              local path="$1" desired="$2" current
              [ -L "$path" ] && [ -d "$path" ] || return 0
              current=$(readlink -- "$path")
              [ "$current" != "$desired" ] || return 0

              case "$current" in
                /nix/store/*) ;;
                *) echo "Refusing to replace unmanaged link: $path" >&2
                  return 1 ;;
              esac
              jq -e --arg path "$path" \
                '(.managedFiles | index($path)) != null' \
                ${lib.escapeShellArg "${config.devenv.state}/files.json"} \
                >/dev/null || {
                  echo "Link is not recorded as Devenv-managed: $path" >&2
                  return 1
                }

              # Remove only the stale link; Devenv recreates it in the next task.
              rm -- "$path"
            }

            # Path interpolation must match Devenv's store target, not a raw source path.
            ${lib.concatStringsSep "\n" (
              lib.mapAttrsToList (
                name: file:
                "prepare_link ${
                  lib.escapeShellArgs [
                    name
                    "${file.file}"
                  ]
                }"
              ) links
            )}
          '';
        };
      };

    packages = builtins.listToAttrs (
      map
        (system: {
          name = system;
          value =
            let
              pkgs = inputs.nixpkgs.legacyPackages.${system};
            in
            {
              devenv-cli = inputs.devenv-cli.packages.${system}.default;
              check-devenv-locks = pkgs.writeShellApplication {
                name = "check-devenv-locks";
                runtimeInputs = [
                  pkgs.git
                  pkgs.jq
                ];
                text = ''
                  # The standard consumer names both inputs "factory". Explicit
                  # arguments also support Factory itself and other input layouts.
                  if [ "$#" -eq 0 ]; then
                    set -- --ci --flake-input factory flake.lock devenv.lock factory
                  fi
                  index=false
                  ci=false
                  flake_input=""
                  while [ "$#" -gt 0 ]; do
                    case "$1" in
                      --git-index) index=true; shift ;;
                      --ci) ci=true; shift ;;
                      --flake-input)
                        [ "$#" -ge 2 ] || { echo 'Missing --flake-input value' >&2; exit 2; }
                        flake_input="$2"; shift 2 ;;
                      *) break ;;
                    esac
                  done
                  if [ "$#" -ne 3 ]; then
                    echo "Usage: check-devenv-locks [--ci | --git-index] [--flake-input name] <flake.lock> <devenv.lock> <devenv-input-name>" >&2
                    exit 2
                  fi
                  flake_lock=$1
                  devenv_lock=$2
                  input_name=$3
                  if [ "$index" = true ]; then
                    scratch=$(mktemp -d)
                    trap 'rm -rf -- "$scratch"' EXIT
                    git show ":$flake_lock" > "$scratch/flake.lock"
                    git show ":$devenv_lock" > "$scratch/devenv.lock"
                    flake_lock="$scratch/flake.lock"
                    devenv_lock="$scratch/devenv.lock"
                  fi
                  if ! jq -es --arg input_name "$input_name" --arg flake_input "$flake_input" '
                    def resolve($nodes; $ref):
                      if ($ref | type) == "string" then $ref
                      else reduce $ref[] as $part ("root";
                        resolve($nodes; $nodes[.].inputs[$part])) end;
                    .[0] as $flake | .[1] as $devenv |
                    (if $flake_input == "" then $flake.nodes.root.inputs
                      else $flake.nodes[$flake.nodes.root.inputs[$flake_input]].inputs end) as $inputs |
                    $devenv.nodes[resolve($devenv.nodes; $devenv.nodes.root.inputs[$input_name])].inputs as $followed |
                    ($inputs | keys) == ($followed | keys) and
                    all($inputs | keys[]; . as $name |
                      ($flake.nodes[$inputs[$name]] | {original, locked}) ==
                      ($devenv.nodes[$followed[$name]] | {original, locked})
                    )
                  ' "$flake_lock" "$devenv_lock" > /dev/null; then
                    echo "Source flake inputs and followed devenv inputs differ; synchronize both locks." >&2
                    exit 1
                  fi
                  # --ci checks the working copy everywhere and also the index in CI.
                  # Keep --git-index as an explicit index-only check.
                  if [ "$ci" = true ] && [ "$index" = false ] && [ "''${CI:-}" = true ]; then
                    "$0" --git-index --flake-input "$flake_input" "$flake_lock" "$devenv_lock" "$input_name"
                  fi
                '';
              };
            };
        })
        [
          "x86_64-linux"
          "aarch64-linux"
          "aarch64-darwin"
        ]
    );
  }
