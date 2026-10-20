{ lib, pkgs, ... }:
{
  options.quantile.docker-client.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.docker-client;
    description = "Docker client and Buildx CLI; no daemon is started by this module.";
  };
}
