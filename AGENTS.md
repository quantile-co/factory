# Factory repository guide

This is the public `quantile-co/factory` repository. Its Nix flake and `nix/`
modules provide the development environment; `tf/` declares this repository's
settings and its dedicated state infrastructure through `tf/project/`. Keep
repository-specific knowledge here, not in a workspace index. Source, tests,
and checked-in workflows take precedence over historical notes.

**README edits require explicit approval.** Never commit credentials, provider
payloads, state, saved plans, or local backend overrides. Keep unrelated
uncommitted changes intact. Review `.pi/memory/MEMORY.md` before changing
knowledge files; dated daily logs are visible to Git for review but must not
be staged automatically. Scratchpad and recovery data stay ignored.

Local, backend-free validation (inside this checkout's pinned direnv shell):

```sh
nix flake check path:.
tofu -chdir=tf fmt -check -recursive
tofu -chdir=tf init -backend=false -input=false -lockfile=readonly
tofu -chdir=tf validate
```

`.github/workflows/check.yaml` runs on pull requests, branch pushes, and manual
dispatch; it checks the flake, Terraform, and Semgrep policies without a remote
backend. `plan.yaml` and `apply.yaml` are separate, manual, protected-main
production workflows. Plan reads remote state; Apply creates a fresh saved plan
and applies those exact bytes in the same guarded job. A source merge or green
Check authorizes neither workflow. Review the current infrastructure and the
proposed Plan before a separately authorized Apply. Preserve WIF, backend
locks, protected environments, and the workflow concurrency guard. Do not use
the Day 0 runbook in `tf/README.md` to recreate an existing installation.
