{ lib, pkgs, ... }:
{
  options.quantile-co.factory.stripe-cli.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.stripe-cli;
    description = "Stripe CLI; authentication and operations are consumer-owned.";
  };
}
