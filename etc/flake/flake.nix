{
  description = "Project development environment";

  inputs = {
    factory.url = "github:quantile-co/factory";
    nixpkgs.follows = "factory/nixpkgs";
  };

  outputs =
    { factory, nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      project =
        { config, pkgs, ... }:
        let
          tools = config.quantile-co.factory;
          copy = source: {
            inherit source;
            mode = "copy";
          };
          seed = source: {
            inherit source;
            mode = "seed";
          };
        in
        {
          quantile-co.factory = {
            flake.packages = {
              direnv = pkgs.direnv;
              jq = pkgs.jq;
              nodejs_24 = pkgs.nodejs_24;
              pnpm = tools.pnpm.package;
            };
            flake.devShell = {
              shellHook = lib.concatStringsSep "\n" [
                tools.files.shellHook
                tools.turbo.shellHook
              ];
              packages = [
                pkgs.git
                pkgs.git-lfs
                pkgs.nix
                pkgs.direnv
                pkgs.jq
                pkgs.nodejs_24
                tools.pnpm.package
              ];
            };
            files.entries = {
              ".envrc" = copy tools.direnv.configFile;
              ".gitignore" = seed tools.git.ignoreFile;
              ".husky/pre-push" = copy tools.husky.prePushFile;
              "biome.json" = copy tools.biome.configFile;
              "package.json" = seed tools.pnpm.packageJsonFile;
              "apps/repo/package.json" = seed tools.pnpm.repoPackageJsonFile;
              "apps/repo/cli.js" = seed tools.pnpm.repoCliFile;
              "pnpm-workspace.yaml" = seed tools.pnpm.workspaceFile;
              "turbo.json" = seed tools.turbo.configFile;
              "tsconfig.json" = seed tools.typescript.configFile;
            };
          };
        };
      configurations = lib.genAttrs systems (
        system:
        (lib.evalModules {
          specialArgs = {
            pkgs = import nixpkgs { inherit system; };
            factoryInputs = factory.inputs;
          };
          modules = [
            factory.nixModules.default
            project
          ];
        }).config.quantile-co.factory.flake.outputs
      );
    in
    {
      packages = builtins.mapAttrs (_: configuration: configuration.packages) configurations;
      devShells = builtins.mapAttrs (_: configuration: configuration.devShells) configurations;
    };
}
