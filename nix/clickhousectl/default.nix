{ lib, pkgs, ... }:
let
  platforms = {
    x86_64-linux = {
      target = "x86_64-unknown-linux-musl";
      hash = "sha256-TBgqkFaTARPG1cZCrx7tQ5PkL4HozZd66CylOinKG5Q=";
    };
    aarch64-linux = {
      target = "aarch64-unknown-linux-musl";
      hash = "sha256-/lZsopCCGDRGIcmWGsWtL5HOIORnf/cJQ19DmRYxmq8=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-LSNWW0t3nJL2pC9JWj4qJFeS/g1aQ5H7dqxaWF7Sm6A=";
    };
  };
in
{
  options.quantile-co.factory.clickhousectl.package = lib.mkOption {
    type = lib.types.package;
    default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
      pname = "clickhousectl";
      version = "0.5.0";
      src = pkgs.fetchurl {
        url = "https://github.com/ClickHouse/clickhousectl/releases/download/v${finalAttrs.version}/clickhousectl-${
          platforms.${pkgs.stdenv.hostPlatform.system}.target
        }-v${finalAttrs.version}.tar.gz";
        inherit (platforms.${pkgs.stdenv.hostPlatform.system}) hash;
      };
      dontBuild = true;
      dontStrip = true;
      installPhase = ''
        runHook preInstall
        install -Dm755 clickhousectl "$out/bin/clickhousectl"
        ln -s clickhousectl "$out/bin/chctl"
        install -Dm644 ${
          pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/ClickHouse/clickhousectl/549427cc5ef954f805c402550931ff71670832c2/LICENSE";
            hash = "sha256-xvWR1iyVWpocAAd+MLdZabtOru1BJM1AIsHqInN/Dk0=";
          }
        } "$out/share/licenses/clickhousectl/LICENSE"
        runHook postInstall
      '';
      meta = {
        description = "Official CLI for ClickHouse Cloud and Managed ClickStack";
        homepage = "https://github.com/ClickHouse/clickhousectl";
        license = lib.licenses.asl20;
        sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
        mainProgram = "clickhousectl";
        platforms = builtins.attrNames platforms;
      };
    });
    description = "ClickHouse control CLI; credentials, telemetry preferences and operations are consumer-owned.";
  };
}
