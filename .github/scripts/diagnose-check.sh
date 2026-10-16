#!/usr/bin/env bash
# Temporary diagnostics for intermittent pre-shell Nix stalls on Check runners.
set -euo pipefail

log=$(mktemp)
trace_dir=$(mktemp -d)
monitor_pid=
cleanup() {
  if [ -n "$monitor_pid" ]; then
    kill "$monitor_pid" 2>/dev/null || :
    wait "$monitor_pid" 2>/dev/null || :
  fi
  rm -f -- "$log"
  rm -rf -- "$trace_dir"
}
trap cleanup EXIT

printf 'Check runner at %s\n' "$(date -u +%FT%TZ)"
df -h /nix
if [ -L /nix ]; then
  printf '/nix points to %s\n' "$(readlink /nix)"
fi
nix --version
if ! command -v strace > /dev/null && command -v sudo > /dev/null && command -v apt-get > /dev/null; then
  echo 'Installing strace for this temporary diagnostic run.'
  if ! (timeout 90 sudo apt-get update -qq &&
        timeout 60 sudo apt-get install -y -qq --no-install-recommends strace); then
    echo 'strace installation failed; continuing with devenv tracing and process snapshots.' >&2
  fi
fi
# Only print non-sensitive Nix settings; never dump tokens or the entire config.
timeout 10 nix config show --json | python3 -c '
import json, sys
config = json.load(sys.stdin)
for key in ("connect-timeout", "stalled-download-timeout", "http-connections", "filetransfer-retry-attempts"):
    print(key + ": " + str(config[key]["value"]))
'

monitor() {
  while sleep 30; do
    idle=$(( $(date +%s) - $(stat -c %Y "$log") ))
    if (( idle < 60 )); then
      continue
    fi
    printf '\n--- No Nix/devenv output for %ss at %s ---\n' "$idle" "$(date -u +%FT%TZ)"
    df -h /nix
    ps -eLo pid,lwp,ppid,stat,wchan:24,etime,comm | \
      awk 'NR == 1 || $7 ~ /nix|devenv|curl|fetchurl/' | head -90 || :
    if command -v strace > /dev/null; then
      echo 'Recent connection, process-wait and lock syscalls (no read/write buffers):'
      mapfile -t trace_files < <(
        find "$trace_dir" -maxdepth 1 -name 'syscalls.*' -type f -printf '%T@ %p\n' |
          sort -nr | head -6 | cut -d' ' -f2-
      )
      for trace_file in "${trace_files[@]}"; do
        printf '%s\n' "$(basename "$trace_file")"
        tail -n 10 "$trace_file"
      done
    fi
    for url in 'https://cache.nixos.org/nix-cache-info' 'https://registry.npmjs.org/'; do
      printf 'Public endpoint %s: ' "$url"
      curl --head --silent --show-error --output /dev/null --max-time 8 \
        --write-out 'HTTP %{http_code}, connect %{time_connect}s, total %{time_total}s\n' "$url" || :
    done
  done
}
monitor &
monitor_pid=$!

# Trace from process start, but never record syscall read/write buffers or environment values.
command=(nix run path:.#devenv-cli -- --trace-to pretty:stderr tasks run check:all)
if command -v strace > /dev/null; then
  echo 'Tracing selected syscalls into a temporary directory; printing only bounded stall snapshots.'
  command=(strace -ff -ttt -T -s 0
    -e trace=futex,epoll_wait,epoll_pwait,poll,ppoll,pselect6,select,connect,getsockopt,flock,fcntl,wait4,waitid,clone,clone3
    -o "$trace_dir/syscalls" "${command[@]}")
fi
"${command[@]}" 2>&1 | tee "$log"
