{ lib, pkgs, ... }:
{
  options.quantile.tf.opentofu.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.opentofu;
    description = "OpenTofu CLI from the locked, devenv-tested nixpkgs input.";
  };
}
