{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.nixcache;
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
          _factory_nixcache_setup() (
            set -euo pipefail
            export PATH=${
              lib.makeBinPath (
                [
                  pkgs.namespace-cli
                  pkgs.jq
                  pkgs.curl
                  pkgs.coreutils
                ]
                ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.procps ]
              )
            }:"$PATH"
            export NIXCACHE_BINARY=${lib.getExe cfg.package}
            workspace=$1
            port=$2
            if ! nsc auth check-login >/dev/null 2>&1; then
                echo "Namespace Nix cache: run nsc login for $workspace, then reload the shell." >&2
                exit 0
            fi
            if ! identity=$(nsc workspace describe --output json 2>/dev/null); then
                echo 'Namespace Nix cache: cannot verify the active workspace; leaving caches unchanged.' >&2
                exit 0
            fi
            if [[ $(jq -r '.name' <<<"$identity") != "$workspace" ]]; then
                echo "Namespace Nix cache: select workspace $workspace with nsc login, then reload the shell." >&2
                exit 0
            fi
            tenant=$(jq -er '.tenant_id | select(type == "string")' <<<"$identity")
            if [[ ! $tenant =~ ^[A-Za-z0-9_-]+$ ]]; then exit 1; fi
            if [[ -n ''${XDG_CACHE_HOME:-} ]]; then
                cache_root=$XDG_CACHE_HOME
            elif [[ $OSTYPE == darwin* ]]; then
                cache_root=$HOME/Library/Caches
            else
                cache_root=$HOME/.cache
            fi
            umask 077
            state="$cache_root/nixcache/$tenant/$port"
            mkdir -p "$state"
            locked=false
            for _ in {1..100}; do
                if mkdir "$state/start.lock" 2>/dev/null; then
                    locked=true
                    break
                fi
                sleep 0.1
            done
            if [[ $locked != true ]]; then
                echo "Namespace Nix cache: startup is locked at $state/start.lock; leaving caches unchanged." >&2
                exit 0
            fi
            trap 'rmdir "$state/start.lock"' EXIT
            url="http://127.0.0.1:$port"
            ready() {
                curl --silent --fail --connect-timeout 1 --max-time 1 "$url/nix-cache-info" >/dev/null
            }
            if [[ -f $state/proxy ]]; then
                read -r pid binary <"$state/proxy"
                if [[ $pid =~ ^[0-9]+$ ]] && process=$(ps -ww -p "$pid" -o command=) &&
                    [[ " $process " == *" $binary -foreground -listen 127.0.0.1:$port "* ]]; then
                    if [[ $binary == "$NIXCACHE_BINARY" ]] && ready; then
                        printf '%s\n' "$url"
                    else
                        echo "Namespace Nix cache: managed proxy $pid needs attention; inspect $state/cacheproxy.log." >&2
                    fi
                    exit 0
                fi
            fi
            if ready; then
                echo "Namespace Nix cache: $url is already in use by an unmanaged proxy; leaving caches unchanged." >&2
                exit 0
            fi
            "$NIXCACHE_BINARY" -foreground -listen "127.0.0.1:$port" \
                -cache_dir "$state/archives" -cache-upstream=local-only \
                -log_file "$state/cacheproxy.log" >"$state/process.log" 2>&1 </dev/null &
            pid=$!
            for _ in {1..100}; do
                if ! kill -0 "$pid" 2>/dev/null; then break; fi
                if ready; then
                    printf '%s %s\n' "$pid" "$NIXCACHE_BINARY" >"$state/proxy"
                    printf '%s\n' "$url"
                    exit 0
                fi
                sleep 0.1
            done
            kill -TERM "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
            echo "Namespace Nix cache: proxy did not start; inspect $state/process.log. Leaving caches unchanged." >&2
          )
          if _nixcache_url=$(_factory_nixcache_setup ${lib.escapeShellArg cfg.workspace} ${toString cfg.port}); then
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
                  *${lib.escapeShellArg " ${cfg.publicKey} "}*) ;;
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
          unset -f _factory_nixcache_setup
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
