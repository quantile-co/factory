{ lib, pkgs, ... }:
{
  options.quantile-co.factory.skopeo.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.skopeo;
    description = "Skopeo CLI for inspecting and copying OCI images; no registry access on import.";
  };
}
