{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.flake;
in
{
  options.quantile-co.factory.flake = {
    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/flake/flake.nix;
      description = "Downstream flake starter; Factory does not consume its own downstream template.";
    };
    packages = lib.mkOption {
      type = lib.types.attrsOf lib.types.package;
      default = { };
      description = "Explicit public per-system packages.";
    };
    devShell.packages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = "Explicit development-shell tools.";
    };
    devShell.shellHook = lib.mkOption {
      type = lib.types.lines;
      default = "";
      description = "Explicit runtime development-shell initialization.";
    };
    outputs = lib.mkOption {
      type = lib.types.raw;
      readOnly = true;
      default = {
        packages = lib.filterAttrs (
          _: package: lib.meta.availableOn pkgs.stdenv.hostPlatform package && !(package.meta.broken or false)
        ) (cfg.packages // { files = config.quantile-co.factory.files.package; });
        devShells.default = pkgs.mkShell {
          packages = cfg.devShell.packages ++ [ config.quantile-co.factory.files.package ];
          inherit (cfg.devShell) shellHook;
        };
      };
      description = "Evaluated per-system native flake outputs.";
    };
  };
}
