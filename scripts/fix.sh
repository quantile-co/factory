#!/usr/bin/env bash
set -euo pipefail

if (($# != 0)); then
    echo 'Usage: pnpm run fix' >&2
    exit 2
fi
: "${FACTORY_FILES_MANIFEST:?Enter the pinned direnv shell first}"
node scripts/files.mjs materialize "$FACTORY_FILES_MANIFEST"
TF_DIR=tf fix-terraform
fix-nixfmt
fix-shfmt
fix-taplo
fix-editorconfig-eof
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec biome check --write --error-on-warnings nix tf scripts package.json tsconfig.json etc/biome
