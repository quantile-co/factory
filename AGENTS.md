# Factory repository guide

This is the public `quantile-co/factory` repository. Its Nix flake and `nix/`
modules provide the development environment; `tf/` declares this repository's
settings and its dedicated state infrastructure through `tf/project/`. Keep
repository-specific knowledge here, not in a workspace index. Do not add
nested `AGENTS.md` files. Source, tests, and checked-in workflows take
precedence over historical notes.

**README edits require explicit approval.** Never commit credentials, provider
payloads, state, saved plans, or local backend overrides. Keep unrelated
uncommitted changes intact. Review `.pi/memory/MEMORY.md` before changing
knowledge files. Review and sanitize dated daily logs before committing them;
scratchpad and recovery data stay ignored.

Local, backend-free validation (inside this checkout's pinned direnv shell):

```sh
nix flake check path:.
tofu -chdir=tf fmt -check -recursive
tofu -chdir=tf init -backend=false -input=false -lockfile=readonly
tofu -chdir=tf validate
```

For source checks, or checks followed by tests, run:

```sh
nix run path:.#devenv-cli -- tasks run --show-output check:all
nix run path:.#devenv-cli -- tasks run --show-output --mode before test:all
```

`check:all` includes policy checks against real source and TypeScript type checking;
`test:all` depends on `check:all` and runs backend-free Vitest integration tests.

Workflows are thin wrappers around repository tasks. Use Actionlint and real
Check runs for workflow integration; do not duplicate fixed YAML values or
third-party action behavior in unit tests.

`.github/workflows/check.yaml` runs on pull requests, non-main branch pushes, and
non-main manual dispatch; it runs `check:all` without a remote backend and remains
the required merge check. `.github/workflows/test.yaml` runs checks then tests on
manual dispatch from main only; it is not a required merge check. Test, Plan and
Apply use the Cachix action's store-scan mode to upload newly built or downloaded
store paths; pre-existing Namespace paths are not uploaded. Check only reads Cachix.
Namespace Cache Volume commits remain main-only. Production workflows use Git-aware
flake references to keep ignored credentials and Terraform files out of the Nix
store. The Test workflow's continuous batching and failure-recovery TODO is not
implemented.

`plan.yaml` and `apply.yaml` are separate, manual, protected-main production
workflows. Plan reads remote state; Apply creates a fresh saved plan and applies
those exact bytes in the same guarded job. A source merge or green Check authorizes
neither workflow. Review the current infrastructure and the proposed Plan before
a separately authorized Apply. Preserve WIF, backend
locks, protected environments, and the workflow concurrency guard. Do not use
the Day 0 runbook in `tf/README.md` to recreate an existing installation.
