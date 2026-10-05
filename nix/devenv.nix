{ inputs }:
if inputs.devenv.rev != inputs.devenv-cli.rev then
  throw "The Devenv CLI and module inputs must use the same revision"
else
{
  packages = builtins.listToAttrs (map (system: {
    name = system;
    value.devenv-cli = inputs.devenv-cli.packages.${system}.default;
  }) [
    "x86_64-linux"
    "aarch64-linux"
    "aarch64-darwin"
  ]);
}
