#!/usr/bin/env bash
set -euo pipefail

nix run --no-write-lock-file .#github-workflow-apply
