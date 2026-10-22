{ lib, ... }:
{
  options.quantile-co.factory.husky.prePushFile = lib.mkOption {
    type = lib.types.path;
    default = ../../etc/husky/pre-push;
    description = "Tracked Husky pre-push entry point; Husky owns its ignored wiring.";
  };
}
