{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.nixcache;
  setup = pkgs.writeShellApplication {
    name = "setup-nixcache";
    runtimeInputs = [
      pkgs.namespace-cli
      pkgs.jq
      pkgs.curl
      pkgs.coreutils
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.procps ];
    text = ''
      export NIXCACHE_BINARY=${lib.getExe cfg.package}
    ''
    + builtins.readFile ./setup.sh;
  };
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
  options.quantile-co.factory.nixcache = {
    workspace = lib.mkOption {
      type = lib.types.str;
      description = "Expected authenticated Namespace workspace when selecting the local shell hook.";
    };
    publicKey = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Public signing key for private outputs; never a private key or credential.";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 18765;
      description = "Loopback port for the local proxy; use distinct ports for different workspaces.";
    };
    shellHook = lib.mkOption {
      type = lib.types.lines;
      default = ''
        if [ -z "''${CI:-}" ]; then
          if _nixcache_url=$(${lib.getExe setup} ${lib.escapeShellArg cfg.workspace} ${toString cfg.port}); then
            if [ -n "$_nixcache_url" ]; then
              _nixcache_substituters=$(${lib.getExe pkgs.nix} config show substituters)
              _nixcache_keys=$(${lib.getExe pkgs.nix} config show trusted-public-keys)
              _nixcache_changed=false
              _nixcache_key_missing=false
              case " $_nixcache_substituters " in
                *" $_nixcache_url "*) ;;
                *)
                  _nixcache_substituters="$_nixcache_url $_nixcache_substituters"
                  _nixcache_changed=true
                  ;;
              esac
              ${lib.optionalString (cfg.publicKey != "") ''
                case " $_nixcache_keys " in
                  *" "${lib.escapeShellArg cfg.publicKey}" "*) ;;
                  *)
                    _nixcache_keys=${lib.escapeShellArg cfg.publicKey}" $_nixcache_keys"
                    _nixcache_changed=true
                    _nixcache_key_missing=true
                    ;;
                esac
              ''}
              if [ "$_nixcache_changed" = true ]; then
                if ${lib.getExe pkgs.nix} store info --json | ${lib.getExe pkgs.jq} -e '.trusted == true' > /dev/null; then
                  printf -v NIX_CONFIG '%s\nsubstituters = %s\ntrusted-public-keys = %s' "''${NIX_CONFIG:-}" "$_nixcache_substituters" "$_nixcache_keys"
                  export NIX_CONFIG
                else
                  _nixcache_allowed=$(${lib.getExe pkgs.nix} config show trusted-substituters)
                  if [ "$_nixcache_key_missing" = false ] && [[ " $_nixcache_allowed " == *" $_nixcache_url "* ]]; then
                    printf -v NIX_CONFIG '%s\nsubstituters = %s' "''${NIX_CONFIG:-}" "$_nixcache_substituters"
                    export NIX_CONFIG
                  else
                    echo 'Namespace Nix cache: the proxy is ready; ask your Nix administrator to configure its substituter and signing key.' >&2
                  fi
                fi
              fi
            fi
          fi
          unset _nixcache_url _nixcache_substituters _nixcache_keys _nixcache_changed _nixcache_key_missing _nixcache_allowed
        fi
      '';
      description = "Opt-in authenticated local reader proxy; skip CI, preserve caches and never prompt for login.";
    };
    package = lib.mkOption {
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
      description = "Pinned Namespace cache proxy; credentials remain runtime-owned.";
    };
  };
}
