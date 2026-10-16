#!/usr/bin/env bash
# Temporary diagnostics. Keep complete traces on success, failure and timeout.
set -euo pipefail
umask 077

root=${DIAGNOSTICS_ROOT:-${RUNNER_TEMP:-/tmp}/factory-check-diagnostics}
mkdir -p "$root"
output=$(mktemp -d "$root/run.XXXXXX")
log=$output/output.log
mkdir "$output/trace"
max_seconds=${DIAGNOSTICS_MAX_SECONDS:-600}
interval=${DIAGNOSTICS_INTERVAL_SECONDS:-15}
grace=${DIAGNOSTICS_GRACE_SECONDS:-5}
for value in "$max_seconds" "$interval" "$grace"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { echo 'Diagnostic intervals must be positive integers.' >&2; exit 2; }
done
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
trace_pid=
monitor_pid=
deadline_pid=
tail_pid=

stop_group() {
  if [ -n "$trace_pid" ] && kill -0 -- "-$trace_pid" 2>/dev/null; then
    kill -TERM -- "-$trace_pid" 2>/dev/null || :
    sleep "$grace"
    kill -KILL -- "-$trace_pid" 2>/dev/null || :
  fi
}
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "$monitor_pid" "$deadline_pid"; do
    if [ -n "$pid" ]; then
      # Helpers may be waiting on sleep or the sampler; do not orphan them.
      pkill -TERM -P "$pid" 2>/dev/null || :
      kill "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
    fi
  done
  stop_group
  if [ -n "$tail_pid" ]; then
    kill "$tail_pid" 2>/dev/null || :
    wait "$tail_pid" 2>/dev/null || :
  fi
  if [ -f "$output/deadline-exceeded" ]; then status=124; fi
  printf 'exit_status=%s\nfinished=%s\n' "$status" "$(date -u +%FT%TZ)" >> "$output/result.txt"
  du -sh "$output"
  printf 'Full diagnostics retained at %s\n' "$output"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

{
  printf 'started=%s\ncommand_deadline_seconds=%s\n' "$(date -u +%FT%TZ)" "$max_seconds"
  df -h /nix "$output"
  nix --version
} | tee "$output/metadata.txt"
if ! command -v strace > /dev/null; then
  timeout 90 sudo apt-get update -qq
  timeout 60 sudo apt-get install -y -qq --no-install-recommends strace
fi
strace --version | head -1 | tee -a "$output/metadata.txt"
# Allowlist only. Never dump credentials, full config, environments or argv.
timeout 10 nix config show --json | python3 -c '
import json, sys
config = json.load(sys.stdin)
for key in ("connect-timeout", "stalled-download-timeout", "http-connections",
            "max-substitution-jobs", "filetransfer-retry-attempts",
            "filetransfer-retry-delay", "filetransfer-retry-delay-rate-limited",
            "filetransfer-retry-max-delay", "filetransfer-retry-jitter",
            "narinfo-cache-negative-ttl", "narinfo-cache-positive-ttl"):
    print(key + ": " + str(config.get(key, {}).get("value", "unavailable")))
print("These are standalone Nix settings; pinned devenv overrides http-connections to 100.")
' | tee "$output/nix-settings.txt"

command=(nix run path:.#devenv-cli -- tasks run check:all)
# Explicit commands support local diagnostic integration tests; CI uses the default.
if (( $# )); then command=("$@"); fi
# Trace all threads from startup. Raw I/O arguments retain fd/pointer/count/timing,
# NEVER buffer contents. No execve, argv, environment, file names or TLS headers.
# Do not use -y/-yy: descriptor paths can contain private information.
# EXITKILL also covers Nix builders that create their own session/process group.
setsid strace --kill-on-exit --seccomp-bpf -ff -ttt -T -s 0 \
  -e trace=futex,epoll_wait,epoll_pwait,epoll_ctl,poll,ppoll,connect,getsockopt,setsockopt,socket,socketpair,shutdown,flock,fcntl,wait4,waitid,clone,clone3,read,write,readv,writev,pread64,pwrite64,recvfrom,recvmsg,recvmmsg,sendto,sendmsg,sendmmsg,close,dup,dup2,dup3,pipe,pipe2,fsync,fdatasync \
  -e raw=read,write,readv,writev,pread64,pwrite64,recvfrom,recvmsg,recvmmsg,sendto,sendmsg,sendmmsg,setsockopt \
  -o "$output/trace/syscalls" "${command[@]}" > "$log" 2>&1 &
trace_pid=$!
tail --pid="$trace_pid" -n +1 -f "$log" &
tail_pid=$!

snapshot() {
  python3 "$script_dir/diagnose-snapshot.py" "$trace_pid" >> "$output/progress.jsonl" 2>> "$output/sampler-errors.log" || :
}
monitor() {
  while kill -0 "$trace_pid" 2>/dev/null; do
    snapshot
    idle=$(( $(date +%s) - $(stat -c %Y "$log") ))
    if (( idle >= 60 )); then
      printf 'Output silent for %ss; recording I/O progress (silence alone is NOT a timeout).\n' "$idle"
    fi
    sleep "$interval"
  done
}
monitor &
monitor_pid=$!
# Independent wall-clock deadline: never reset by output or blocked by sampling.
# Kill the entire dedicated process group, then escalate even if TERM is ignored.
(
  sleep "$max_seconds"
  echo "Command exceeded ${max_seconds}s; terminating traced process group $trace_pid." | tee "$output/deadline-exceeded"
  stop_group
) &
deadline_pid=$!
status=0
wait "$trace_pid" || status=$?
# Give tail one cycle to deliver the final output; the file is already complete.
sleep 1
exit "$status"
