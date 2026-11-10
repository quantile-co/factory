{ lib, pkgs, ... }:
let
  platforms = {
    x86_64-linux = {
      target = "linux_amd64";
      hash = "sha256-j+C7yneYFfzRj9n4447bFQ834cQkg8IXmgGVotjohKY=";
    };
    aarch64-linux = {
      target = "linux_arm64";
      hash = "sha256-RVRhdMdjQvKEZEgytlF/AX6hdYVnIhTh5ky/fANtC5U=";
    };
    aarch64-darwin = {
      target = "darwin_arm64";
      hash = "sha256-A/UEwCi4f3cU5JGy2haGPmpaMQGZmexvDHtUXyP/HVw=";
    };
  };
in
{
  options.quantile-co.factory.nixcache.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
      pname = "nixcache";
      version = "0.5.0";
      src = pkgs.fetchurl {
        url = "https://public.namespaceblobs.com/nixcache/releases/v${finalAttrs.version}/nixcache_${finalAttrs.version}_${
          platforms.${pkgs.stdenv.hostPlatform.system}.target
        }.tar.gz";
        inherit (platforms.${pkgs.stdenv.hostPlatform.system}) hash;
      };
      sourceRoot = ".";
      dontBuild = true;
      dontStrip = true;
      installPhase = ''
        runHook preInstall
        install -Dm755 nixcache "$out/bin/nixcache"
        runHook postInstall
      '';
      meta = {
        description = "Namespace Nix binary-cache proxy";
        homepage = "https://namespace.so/docs/integrations/nix";
        license = lib.licenses.unfree;
        sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
        mainProgram = "nixcache";
        platforms = builtins.attrNames platforms;
      };
    });
    description = "Pinned Namespace cache proxy; authentication and cache configuration remain runtime-owned.";
  };
}
