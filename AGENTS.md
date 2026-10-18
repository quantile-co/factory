# Factory repository guide

This is the public `quantile-co/factory` repository. Its Nix flake and `nix/`
modules provide the development environment. `tf/infrastructure/` is the deployment
root; `tf/modules/project/github/` owns repository settings and
`tf/modules/project/gcp/` owns GCP projects, storage and IAM. Keep
repository-specific knowledge here, not in a workspace index. Do not add
nested `AGENTS.md` files. Source, tests, and checked-in workflows take
precedence over historical notes.

**README edits require explicit approval.** Never commit credentials, provider
payloads, state, saved plans, or local backend overrides. Keep unrelated
uncommitted changes intact. Review `.pi/memory/MEMORY.md` before changing
knowledge files. Memory updates, including dated daily logs, may be included in
normal commits after checking that they contain no sensitive details; no separate
commit or approval is required. Remove sensitive content before staging.
Scratchpad and recovery data stay ignored.

Local, backend-free validation (inside this checkout's pinned direnv shell):

```sh
nix flake check path:.
tofu -chdir=tf fmt -check -recursive
tofu -chdir=tf/infrastructure init -backend=false -input=false -lockfile=readonly
tofu -chdir=tf/infrastructure validate
```

For source checks, or checks followed by tests, run:

```sh
nix run path:.#devenv-cli -- tasks run --show-output check:all
nix run path:.#devenv-cli -- tasks run --show-output --mode before test:all
```

`check:all` includes policy checks against real source, TypeScript type checking,
and Biome lint/format checks without rewriting source. `test:all` depends on
`check:all` and runs backend-free Vitest integration tests.

Apply source fixes explicitly:

```sh
nix run path:.#devenv-cli -- tasks run --show-output --mode before fix:all
```

`fix:all` runs Terraform formatting (no backend initialization) and safe Biome
fixes; it never enables `--unsafe`. TypeScript commands and the pinned Biome
version live in `package.json`. Both Biome scripts use the same configuration and
file selection, excluding README files and unrelated native fixtures. The shared
native template is `etc/biome/default.json`, exposed by
`quantile.ts.biome.configFile` and linked as root `biome.json` by Devenv. Consumers
choose their own placement, overrides, and package scripts. No automatic fixing
hooks are installed.

SecretSpec uses `etc/secretspec/secretspec.toml` through the overridable
`quantile.secretspec.configFile`. Factory points `SECRETSPEC_FILE` at its Nix-store
copy; no root manifest or bootstrap step is needed. Only declarations enter the
store. `quantile.secretspec.shellHook` exports values at runtime and stops startup
on failure. Native Devenv SecretSpec resolution stays disabled in `devenv.yaml`;
never map resolved secrets into Nix `env` attributes. Select a workflow profile
before starting Devenv; default/check require no credentials, while test/plan/apply
require the Cachix token. Profiles have no scopes and do not clear ambient secrets.
For file providers, relative paths are relative to the manifest, not the checkout;
use absolute runtime paths with a store-backed manifest. Consumers may instead
seed and commit a root manifest, then remove the file override for native discovery.
File-valued `as_path` cleanup is not managed by the shell exporter.

The infrastructure root composes the two project modules. Child-module inputs
and outputs are unprefixed; root inputs and outputs retain `gcp_`/`gh_` to
distinguish the systems. Additional GCP module instances can reuse the same
GitHub repository and maintainer ID outputs without managing GitHub resources
or requiring its provider. Keep GitHub environments named `prod` and `non-prod`.
Do not add compatibility flags or `moved` blocks; existing state needs a separately
approved one-time address migration before deploying the module split. Preserve
the state bucket and `repository/prod` prefix.

Workflows call `plan:infrastructure` and `apply:infrastructure`. These tasks and
`check:all` set `TF_DIR=tf/infrastructure`; `fix:all` sets `TF_DIR=tf` to format the
whole tree. Keep this setting task-scoped. SecretSpec's manifest setting stays
shell-wide because its loader runs before tasks. Reusable Nix tools retain a
caller-overridable `TF_DIR`, defaulting to `tf`.
Workflows are thin wrappers around repository tasks. Use Actionlint and real
Check runs for workflow integration; do not duplicate fixed YAML values or
third-party action behavior in unit tests.

For our own changes, push a branch, wait for Check on the exact commit, then
fast-forward main without opening a PR or bypassing branch protection. External
contributors use fork PRs and workflow-run approval. Reserve `dependabot/**` for
Dependabot; those branches are checked by PR events only to avoid duplicate runs.

`.github/workflows/check.yaml` runs on pull requests, non-main branch pushes
except `dependabot/**`, and non-main manual dispatch; it runs `check:all` without
a remote backend and remains the required merge check. `.github/workflows/test.yaml` runs checks then tests on
manual dispatch from main only; it is not a required merge check. Test, Plan and
Apply use the Cachix action's store-scan mode to upload newly built or downloaded
store paths; pre-existing Namespace paths are not uploaded. Check only reads Cachix.
Namespace Cache Volume commits remain main-only. Production workflows use Git-aware
flake references to keep ignored credentials and Terraform files out of the Nix
store. The Test workflow's continuous batching and failure-recovery TODO is not
implemented.

`plan.yaml` and `apply.yaml` are separate, manual, protected-main production
workflows. Plan saves its output in private GCS and publishes a non-sensitive
GitHub receipt. Apply accepts that artifact ID, verifies provenance, source,
backend, expiry (24 hours) and integrity, and applies the saved plan without
replanning. Storage and validation live in `nix/tf.nix`; authorization, stock
artifact upload and post-upload cleanup stay in the workflows. `GCP_MAINTAINERS`
is an explicit JSON array of Google account emails, mapped to `gcp_maintainers`.
Terraform grants them read access only to `plans/` objects, not state or project
administration; do not replace this with a manual IAM grant. A source merge
or green Check authorizes neither workflow. Preserve WIF, backend locks,
protected environments, and the workflow concurrency guard.

Use [deploy](.pi/skills/deploy/SKILL.md) for existing infrastructure and
[day-zero-deploy](.pi/skills/day-zero-deploy/SKILL.md) only for a confirmed new
installation. Each mutation, dispatch, migration or retry needs separate approval.
Never recreate existing state or remove standing/CI access during bootstrap cleanup.
