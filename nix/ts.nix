{ lib, pkgs, ... }:
{
  options.quantile.ts = {
    node.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nodejs_24;
      description = "Node.js for TypeScript tooling.";
    };

    pnpm.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.pnpm;
      description = "pnpm for project dependencies.";
    };
  };
}
