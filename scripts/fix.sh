#!/usr/bin/env bash
set -euo pipefail

: "${FACTORY_FILES_MANIFEST:?Enter the pinned direnv shell first}"
node scripts/files.mjs materialize "$FACTORY_FILES_MANIFEST"
TF_DIR=tf fix-terraform
fix-nixfmt
fix-shfmt
fix-taplo
fix-editorconfig-eof
pnpm install --frozen-lockfile --ignore-scripts
pnpm run fix:code
