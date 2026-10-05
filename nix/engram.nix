{ lib, pkgs, ... }:
let
  version = "3.0.0";
  targets = {
    x86_64-linux = {
      name = "linux_amd64";
      hash = "sha256-Irv9ge6QcaBNRG9lOELDg6MQG1lOiClRmmOnx0dgLmk=";
    };
    aarch64-linux = {
      name = "linux_arm64";
      hash = "sha256-accX378QczrwSTxwaVT0DjfPZUVofCwZA+SxRiwWza0=";
    };
    x86_64-darwin = {
      name = "darwin_amd64";
      hash = "sha256-aMw+67smXRxFmZpCnR5ndBULpxrACPTdOBudc7EMed0=";
    };
    aarch64-darwin = {
      name = "darwin_arm64";
      hash = "sha256-VOCA7WSh0be4pdWeWm0XEArb1ppqr7tz0nDb6zfAMmY=";
    };
  };
  target = targets.${pkgs.stdenv.hostPlatform.system}
    or (throw "Engram is not available for ${pkgs.stdenv.hostPlatform.system}");
  package = pkgs.stdenvNoCC.mkDerivation {
    pname = "engram";
    inherit version;

    src = pkgs.fetchurl {
      url = "https://github.com/Gentleman-Programming/engram/releases/download/v${version}/engram_${version}_${target.name}.tar.gz";
      inherit (target) hash;
    };

    unpackPhase = ''tar -xzf "$src" engram'';
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''install -Dm755 engram "$out/bin/engram"'';

    meta = {
      description = "Engram memory server for Pi";
      mainProgram = "engram";
      platforms = builtins.attrNames targets;
    };
  };
in
{
  options.quantile.engram.package = lib.mkOption {
    type = lib.types.package;
    default = package;
    description = "Engram memory server executable for the current system.";
  };
}
