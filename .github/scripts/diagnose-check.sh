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
nix --version
if ! command -v strace > /dev/null && command -v sudo > /dev/null && command -v apt-get > /dev/null; then
  echo 'Installing strace for this temporary diagnostic run.'
  if ! (timeout 90 sudo apt-get update -qq &&
        timeout 60 sudo apt-get install -y -qq --no-install-recommends strace); then
    echo 'strace installation failed; process snapshots will remain available.' >&2
  fi
fi
# Never dump Nix credentials or the full configuration to public CI logs.
timeout 10 nix config show --json | python3 -c '
import json, sys
config = json.load(sys.stdin)
for key in ("connect-timeout", "stalled-download-timeout", "http-connections", "filetransfer-retry-attempts"):
    print(key + ": " + str(config[key]["value"]))
'

monitor() {
  traced=false
  while sleep 30; do
    idle=$(( $(date +%s) - $(stat -c %Y "$log") ))
    if (( idle < 60 )); then
      continue
    fi
    printf '\n--- No Nix/devenv output for %ss at %s ---\n' "$idle" "$(date -u +%FT%TZ)"
    df -h /nix
    ps -eLo pid,lwp,ppid,stat,wchan:24,etime,comm | \
      awk 'NR == 1 || $7 ~ /nix|devenv|curl|fetchurl/' | head -90 || :
    for url in 'https://cache.nixos.org/nix-cache-info' 'https://devenv.cachix.org/nix-cache-info' 'https://registry.npmjs.org/'; do
      printf 'Public endpoint %s: ' "$url"
      curl --head --silent --show-error --output /dev/null --max-time 8 \
        --write-out 'HTTP %{http_code}, connect %{time_connect}s, total %{time_total}s\n' "$url" || :
    done
    if [ "$traced" = false ] && command -v strace > /dev/null && command -v sudo > /dev/null; then
      traced=true
      devenv_pid=$(ps -eo pid=,comm= | awk '$2 == ".devenv-wrapped" {print $1; exit}')
      if [ -n "$devenv_pid" ]; then
        echo "Sampling safe syscalls on stalled devenv PID $devenv_pid for 8s."
        # Attach only after a stall. No read/write payloads, process arguments or environment values.
        timeout --signal=INT --kill-after=2 8 sudo -n strace -f -ttT -s 0 \
          -e trace=futex,epoll_wait,epoll_pwait,poll,ppoll,connect,getsockopt,flock,fcntl,wait4,waitid \
          -p "$devenv_pid" -o "$trace_dir/stall" > "$trace_dir/strace-output" 2>&1 || :
        if [ -s "$trace_dir/strace-output" ]; then
          echo 'strace status:'
          tail -n 5 "$trace_dir/strace-output"
        fi
        if [ -s "$trace_dir/stall" ]; then
          echo 'Last 60 selected syscall events:'
          tail -n 60 "$trace_dir/stall"
        fi
      fi
    fi
  done
}
monitor &
monitor_pid=$!

# Keep the ordinary check command: verbose tracing from process start obscured the stall.
nix run path:.#devenv-cli -- tasks run check:all 2>&1 | tee "$log"
