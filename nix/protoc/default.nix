{ lib, pkgs, ... }:
{
  options.quantile.protoc = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.protobuf;
      description = "protoc compiler.";
    };
    generators = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = "protoc plugins; Go and Connect-Go are included by default.";
    };
  };

  # Contribute defaults here so mkAfter can append and mkForce can replace them.
  config.quantile.protoc.generators = [
    pkgs.protoc-gen-go
    pkgs.protoc-gen-connect-go
  ];
}
