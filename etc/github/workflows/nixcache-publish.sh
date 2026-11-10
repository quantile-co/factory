#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"

: "${NIX_CACHE_PRIVATE_KEY:?Configure the cache private signing key}"
: "${NIX_CACHE_PUBLIC_KEY:?Configure the cache public signing key}"
umask 077
key_file=$(mktemp "$RUNNER_TEMP/nixcache-key.XXXXXX")
trap 'rm -f "$key_file"' EXIT
printf '%s\n' "$NIX_CACHE_PRIVATE_KEY" >"$key_file"
unset NIX_CACHE_PRIVATE_KEY
if [ "$(nix key convert-secret-to-public <"$key_file")" != "$NIX_CACHE_PUBLIC_KEY" ]; then
    echo 'Namespace Nix cache signing keys do not match' >&2
    exit 1
fi
# Include restored paths too: a volume hit need not have been published remotely.
nix path-info --all | nix copy --stdin \
    --to "http://127.0.0.1:18765?secret-key=$key_file"
