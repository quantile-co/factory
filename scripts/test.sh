#!/usr/bin/env bash
set -euo pipefail

pnpm run check
pnpm exec vitest run --maxWorkers=4 "$@"
