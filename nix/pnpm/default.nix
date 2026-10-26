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
          # Preserve the native task order while pinning the selected runtime.
          builtins.replaceStrings
            [ "\"scripts\": {" ]
            [ "\"packageManager\": \"pnpm@${cfg.package.version}\",\n  \"scripts\": {" ]
            (builtins.readFile ../../etc/pnpm/package.json)
        )
      );
      description = "Native package.json seed; existing project scripts, dependencies and pins stay repository-owned.";
    };
    repoPackageJsonFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pnpm/apps/repo/package.json;
      description = "Repository-owned app manifest seed for managed-file checks and fixes.";
    };
    repoCliFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pnpm/apps/repo/cli.js;
      description = "Minimal repository CLI seed; consumers extend their own checks and fixes.";
    };
    workspaceFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/pnpm/pnpm-workspace.yaml;
      description = "Native workspace and dependency-build-policy seed.";
    };
  };
}
