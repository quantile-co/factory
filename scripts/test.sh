#!/usr/bin/env bash
set -euo pipefail

pnpm run check
pnpm run test:unit
