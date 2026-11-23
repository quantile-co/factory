{
  config,
  lib,
  pkgs,
  ...
}:
let
  template = ../../etc/direnv/.envrc;
  key = config.quantile-co.factory.nixcache.publicKey;
in
{
  options.quantile-co.factory.direnv.configFile = lib.mkOption {
    type = lib.types.path;
    default =
      if key == "" then
        template
      else
        pkgs.writeText ".envrc" (
          builtins.replaceStrings [ "cache_public_key=''" ] [ "cache_public_key=${lib.escapeShellArg key}" ] (
            builtins.readFile template
          )
        );
    description = "Direnv flake bootstrap template; commit the copy and approve it with direnv allow.";
  };
}
