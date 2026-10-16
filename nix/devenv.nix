{ inputs }:
if inputs.devenv.rev != inputs.devenv-cli.rev then
  throw "The Devenv CLI and module inputs must use the same revision"
else
{
  packages = builtins.listToAttrs (map (system: {
    name = system;
    value = let
      pkgs = inputs.nixpkgs.legacyPackages.${system};
    in {
      devenv-cli = inputs.devenv-cli.packages.${system}.default;
      check-devenv-locks = pkgs.writeShellApplication {
        name = "check-devenv-locks";
        runtimeInputs = [ pkgs.git pkgs.jq ];
        text = ''
          index=false
          if [ "''${1:-}" = --git-index ]; then
            index=true
            shift
          fi
          if [ "$#" -ne 3 ]; then
            echo "Usage: check-devenv-locks [--git-index] <flake.lock> <devenv.lock> <devenv-input-name>" >&2
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
          if ! jq -es --arg input_name "$input_name" '
            .[0] as $flake | .[1] as $devenv |
            $flake.nodes.root.inputs as $inputs |
            $devenv.nodes[$devenv.nodes.root.inputs[$input_name]].inputs as $followed |
            ($inputs | keys) == ($followed | keys) and
            all($inputs | keys[]; . as $name |
              ($flake.nodes[$inputs[$name]] | {original, locked}) ==
              ($devenv.nodes[$followed[$name]] | {original, locked})
            )
          ' "$flake_lock" "$devenv_lock" > /dev/null; then
            echo "Source flake inputs and followed devenv inputs differ; synchronize both locks." >&2
            exit 1
          fi
        '';
      };
    };
  }) [
    "x86_64-linux"
    "aarch64-linux"
    "aarch64-darwin"
  ]);
}
