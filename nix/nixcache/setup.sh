#!/usr/bin/env bash
set -euo pipefail

# Invoked by the opt-in shell hook, never during Nix evaluation.
if [[ -n ${CI:-} ]]; then exit 0; fi
: "${NIXCACHE_BINARY:?}"
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
if [[ -n ${XDG_CACHE_HOME:-} ]]; then
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
