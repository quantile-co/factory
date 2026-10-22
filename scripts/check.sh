#!/usr/bin/env bash
set -euo pipefail

: "${FACTORY_FILES_MANIFEST:?Enter the pinned direnv shell first}"
node scripts/files.mjs check "$FACTORY_FILES_MANIFEST"
nix flake check .
check-git-hooks
check-nixfmt
check-deadnix
check-statix
check-editorconfig
check-shellcheck
check-shfmt
check-markdown
check-actionlint
test-semgrep
check-semgrep
check-trivy
check-typos
check-vale
check-yamllint
check-taplo
check-taplo-format
check-terraform-nonempty tf
TF_DIR=tf check-terraform-format
TF_DIR=tf/infrastructure check-terraform
TF_DIR=tf/infrastructure check-tflint
check-opa --policy tf/infrastructure --namespace terraform.infrastructure -- tf/infrastructure/main.tf
check-opa --policy tf/modules/project/github --namespace terraform.project.github -- tf/modules/project/github/main.tf
check-opa --policy tf/modules/project/gcp --namespace terraform.project.gcp -- tf/modules/project/gcp/main.tf
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check:code
