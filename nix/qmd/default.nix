{
  lib,
  pkgs,
  llmAgents,
  ...
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  # Keep upstream's package set so fixed-output dependencies and QMD remain
  # substitutable from Numtide; only replace how missing tarballs are fetched.
  upstreamPkgs = import llmAgents.inputs.nixpkgs { inherit system; };
  bun2nixLib = (llmAgents.inputs.bun2nix.overlays.default upstreamPkgs upstreamPkgs).bun2nix;
in
{
  options.quantile-co.factory.qmd = {
    package = lib.mkOption {
      type = lib.types.package;
      # External fetchurl builders exec before downloading, avoiding the
      # inherited callback mutex in builtin:fetchurl (NixOS/nix#16581).
      default = llmAgents.packages.${system}.qmd.override { inherit bun2nixLib; };
      description = "QMD search CLI for Pi memory.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/qmd/index.yml;
      description = "Canonical project-local QMD bootstrap seed; repositories own collections and models after creation.";
    };
  };
}
