{ lib, pkgs, ... }:
{
  options.quantile-co.factory.tailscale.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.tailscale;
    description = "Tailscale CLI package; daemon setup and tailnet access are consumer-owned.";
  };
}
