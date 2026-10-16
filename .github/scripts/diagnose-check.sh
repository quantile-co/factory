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
    # Include blocked threads even when their trace files have stopped changing.
    while read -r tid; do
      if [ -f "$trace_dir/syscalls.$tid" ]; then
        printf '\nLast syscalls for thread %s:\n' "$tid"
        tail -n 12 "$trace_dir/syscalls.$tid"
        printf '\n'
      fi
    done < <(ps -eLo lwp=,comm= | awk '$2 ~ /devenv/ {print $1}' | head -24)
    if (( idle >= 180 )); then
      echo 'Ending diagnostic run after capturing three minutes of stalled progress.' >&2
      # Only target the process launched by this script, never another runner job.
      kill -TERM "$trace_pid" 2>/dev/null || :
      return
    fi
  done
}
# Parent tracing works on this runner; late attachment is forbidden. Seccomp
# filtering avoids stops on unrelated syscalls. Do not enable pretty/verbose tracing.
command -v strace > /dev/null
setsid strace --seccomp-bpf -ff -ttt -T -s 0 \
  -e trace=futex,epoll_wait,epoll_pwait,poll,ppoll,connect,getsockopt,flock,fcntl,wait4,waitid,clone,clone3 \
  -o "$trace_dir/syscalls" \
  nix run path:.#devenv-cli -- tasks run check:all > "$log" 2>&1 &
trace_pid=$!
tail --pid="$trace_pid" -n +1 -f "$log" &
tail_pid=$!
monitor &
monitor_pid=$!
status=0
wait "$trace_pid" || status=$?
# Stop any tracees left behind by a watchdog-triggered termination.
kill -TERM -- "-$trace_pid" 2>/dev/null || :
wait "$tail_pid" || :
exit "$status"
