{ lib, pkgs, ... }:
{
  options.quantile.protobuf = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.protobuf;
      description = "protoc compiler; no implicit schema generation.";
    };
    buf.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.buf;
      description = "Buf CLI; consumers own buf.yaml and buf.gen.yaml.";
    };
    generators = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = "Optional generator packages; additions merge with Go/Connect defaults and mkForce replaces them.";
    };
  };

  # A module contribution, not an option default: mkAfter can append generators
  # while mkForce can opt out. Nothing is installed or run on module import.
  config.quantile.protobuf.generators = [
    pkgs.protoc-gen-go
    pkgs.protoc-gen-connect-go
  ];
}
