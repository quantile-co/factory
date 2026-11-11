{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.hindsight;
  json = pkgs.formats.json { };
  upstream = "@vectorize-io/hindsight-coding-agents";
  upstreamVersion =
    (builtins.fromJSON (builtins.readFile ../../package.json)).devDependencies.${upstream};
  platforms = {
    x86_64-linux = {
      suffix = "linux-amd64";
      sha256 = "499300ee4444249e609f9bbdc8a2966cb763cc92924aa452b9e9510ead1df54b";
    };
    aarch64-linux = {
      suffix = "linux-arm64";
      sha256 = "7ae3d79d59c91aa0484e8d8b8dc8b8cce660f1847297c4fd25dbe4697eefd9f0";
    };
    x86_64-darwin = {
      suffix = "darwin-amd64";
      sha256 = "dde7b26f7aa31335ff28d45f1d8e4944dc6d5c6467bf5b70412bdbc96cef653d";
    };
    aarch64-darwin = {
      suffix = "darwin-arm64";
      sha256 = "4b92944c8c1838b9d9264a2057dd6c852b7283522400a446a8fa907ee5cc5a12";
    };
  };
  platform = platforms.${pkgs.stdenv.hostPlatform.system};

in
{
  options.quantile-co.factory.hindsight = {
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.stdenvNoCC.mkDerivation rec {
        pname = "hindsight-cli";
        version = "1.2.1";
        src = pkgs.fetchurl {
          url = "https://github.com/vectorize-io/hindsight/releases/download/v${version}/hindsight-${platform.suffix}";
          inherit (platform) sha256;
        };
        dontUnpack = true;
        nativeBuildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
        buildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [
          pkgs.stdenv.cc.cc.lib
          pkgs.openssl
        ];
        installPhase = ''
          runHook preInstall
          install -Dm755 "$src" "$out/bin/hindsight"
          runHook postInstall
        '';
        meta = {
          description = "Native Hindsight Cloud CLI; no local memory server";
          homepage = "https://github.com/vectorize-io/hindsight";
          license = lib.licenses.mit;
          mainProgram = "hindsight";
          platforms = builtins.attrNames platforms;
          sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
        };
      };
      description = "Pinned upstream CLI for recall, explicit imports, corrections, deletions and verification.";
    };
    bankId = lib.mkOption {
      type = lib.types.strMatching "[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*";
      description = "Explicit organization-qualified bank ID; never derive it from a checkout basename.";
    };
    configFile = lib.mkOption {
      type = lib.types.path;
      default = json.generate "hindsight-coding-agent.json" (
        builtins.fromJSON (builtins.readFile ../../etc/hindsight/coding-agent.json)
        // {
          bankId = cfg.bankId;
        }
      );
      description = "Nonsecret native configuration; copy to .pi/hindsight.json. Authentication stays in HINDSIGHT_API_TOKEN.";
    };
    piSettingsFile = lib.mkOption {
      type = lib.types.path;
      default =
        let
          settings = builtins.fromJSON (builtins.readFile config.quantile-co.factory.pi.settingsFile);
        in
        json.generate "hindsight-pi-settings.json" (
          settings
          // {
            packages =
              builtins.filter (
                package: !(builtins.isString package && lib.hasPrefix "npm:pi-memory" package)
              ) settings.packages
              ++ [ "npm:${upstream}@${upstreamVersion}" ];
            # Upstream has no Pi manifest; load its entrypoint explicitly after
            # Pi installs the pinned package into the trusted project's npm root.
            extensions = settings.extensions ++ [ "./npm/node_modules/${upstream}/dist/pi.js" ];
          }
        );
      description = "Opt-in Pi settings replacing pi-memory with the pinned upstream Hindsight extension directly.";
    };
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        factory_hindsight_root="$(${lib.getExe pkgs.git} rev-parse --show-toplevel)" || return
        export HINDSIGHT_CONFIG="$factory_hindsight_root/.pi/hindsight.json"
        export HINDSIGHT_OPT_IN_PATHS="$factory_hindsight_root"
        unset PI_MEMORY_DIR PI_MEMORY_EXIT_SUMMARY
        unset factory_hindsight_root
      '';
      description = "Select checkout-local native configuration without reading credentials, creating banks or uploading memory.";
    };
  };
}
