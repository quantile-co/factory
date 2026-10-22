{
  nixpkgs,
  systems,
  modules ? [ ],
  nixpkgsConfig ? { },
  perSystem,
}:
let
  configurations = nixpkgs.lib.genAttrs systems (
    system:
    let
      pkgs = import nixpkgs {
        inherit system;
        config = nixpkgsConfig;
      };
      inherit
        (pkgs.lib.evalModules {
          specialArgs = { inherit pkgs; };
          inherit modules;
        })
        config
        ;
      repository = perSystem {
        inherit pkgs;
        factory = config.quantile-co.factory;
      };
      files = import ../files { inherit pkgs; } repository.files;
    in
    {
      packages = pkgs.lib.filterAttrs (
        _: package:
        pkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform package && !(package.meta.broken or false)
      ) (repository.exports // { inherit files; });
      devShells.default = pkgs.mkShell {
        packages = repository.packages ++ [ files ];
      };
    }
  );
in
{
  packages = builtins.mapAttrs (_: configuration: configuration.packages) configurations;
  devShells = builtins.mapAttrs (_: configuration: configuration.devShells) configurations;
}
