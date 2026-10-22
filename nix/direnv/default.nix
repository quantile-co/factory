{ lib, ... }:
{
  options.quantile-co.factory.direnv.configFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/direnv/.envrc;
    description = "Direnv flake bootstrap template; commit the copy and approve it with direnv allow.";
  };
}
