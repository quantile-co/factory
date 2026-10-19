{ lib, pkgs, ... }:
{
  options.quantile.protoc = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.protobuf;
      description = "protoc compiler; no implicit schema generation.";
    };
    generators = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = "Optional protoc plugins; additions merge with Go/Connect defaults and mkForce replaces them.";
    };
  };

  # Module contribution, not option default: mkAfter appends and mkForce opts out.
  config.quantile.protoc.generators = [ pkgs.protoc-gen-go pkgs.protoc-gen-connect-go ];
}
