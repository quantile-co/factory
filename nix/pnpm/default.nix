{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.pnpm;
in
{
  options.quantile-co.factory.pnpm = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.pnpm;
      description = "Selected pnpm runtime; new manifest seeds use its version.";
    };
    packageJsonFile = lib.mkOption {
      type = lib.types.path;
      default = config.quantile-co.factory.biome.formatFile "package.json" (
        pkgs.writeText "package.json" (
          builtins.toJSON (
            (builtins.fromJSON (builtins.readFile ../../etc/pnpm/package.json))
            // {
              packageManager = "pnpm@${cfg.package.version}";
            }
          )
        )
      );
      description = "Native package.json seed; existing project scripts, dependencies and pins stay repository-owned.";
    };
    workspaceFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pnpm/pnpm-workspace.yaml;
      description = "Native workspace and dependency-build-policy seed.";
    };
  };
}
