#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${GITHUB_ENV:?}"

: "${NIX_CACHE_PUBLIC_KEY:?Configure the cache public signing key}"
umask 077
proxy="$(nix build --no-link --print-out-paths '.#nixcache')/bin/nixcache"
"$proxy" -foreground -cache_dir "$RUNNER_TEMP/nixcache" \
    >"$RUNNER_TEMP/nixcache.log" 2>&1 &
pid=$!
printf '%s\n' "$pid" >"$RUNNER_TEMP/nixcache.pid"
ready=false
for _ in {1..30}; do
    if curl --silent --fail http://127.0.0.1:18765/nix-cache-info >/dev/null; then
        ready=true
        break
    fi
    kill -0 "$pid"
    sleep 1
done
if [ "$ready" != true ]; then
    echo "Namespace Nix cache did not become ready; inspect $RUNNER_TEMP/nixcache.log" >&2
    exit 1
fi
mkdir -p "$HOME/.config/nix"
printf '\nextra-substituters = http://127.0.0.1:18765\nextra-trusted-public-keys = %s\n' \
    "$NIX_CACHE_PUBLIC_KEY" >>"$HOME/.config/nix/nix.conf"
printf 'NIX_CACHE_SUBSTITUTER=http://127.0.0.1:18765\n' >>"$GITHUB_ENV"
