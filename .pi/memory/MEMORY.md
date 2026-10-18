# Project memory

Source, tests, current workflows, and the root `AGENTS.md` take precedence over
historical notes. Keep only reviewed, repository-specific knowledge here.
Never commit credentials, customer data, provider payloads, state, saved plans,
raw transcripts, scratchpad, or recovery data. Memory updates, including dated
daily logs, may accompany normal commits after checking for sensitive details;
no separate commit or approval is required. Remove sensitive content before
staging. The user wants non-sensitive project history preserved.

## Configuration and tool boundaries

#decision [[factory-config-layout]] [[factory-executable-config]]
Factory is a shared Nix flake, not a shared devenv configuration. Keep reusable
native-format assets under `etc/`, separate from `nix/`. Downstream repositories
choose whether to copy, patch, generate, or link those assets and where to put
them. Do not encode elaborate mergeable tool configurations in Nix or force
placement. Keep simple tool modules flat unless they need multiple files.

Reusable check/plan/apply executables are ordinary Nix packages, independent of
devenv and CI. They read the consuming repository's native configuration at
runtime, with explicit overrides where needed; never bake Factory's template
paths into them. Devenv tasks orchestrate packages. Production authorization
belongs in CI wrappers, not reusable Terraform executables. Keep `tf/` native:
HCL, Rego/Conftest, and TypeScript/Vitest, without Nix references.

#decision [[factory-node-tooling]] [[pi-memory-direnv]]
Factory uses pinned Node/pnpm for its TypeScript/Vitest checks, with frozen
`pnpm-lock.yaml` installs. Keep npm separately available for Pi-managed local
packages; do not migrate or delete ignored `.pi/npm/` data. Launch Pi through
the repository's direnv shell so `.envrc` supplies `PI_MEMORY_DIR`; do not add a
global memory-routing extension. QMD's native template is under `etc/qmd/` and
its local configuration is linked by `devenv.nix`.

## Workflow and production boundaries

#decision [[factory-workflow-boundary]] [[factory-check-events]]
Keep workflows thin wrappers around Nix-backed tasks. Use Actionlint and real
Check runs; do not add tests that merely repeat YAML literals, action pins, or
third-party behavior. Keep only a root `AGENTS.md`. README edits require explicit
approval.

For repository-writer changes, push a branch, wait for Check on the exact commit,
then fast-forward main without a PR or protection bypass. Keep fork PR checks.
Dependabot uses PR checks only: exclude `dependabot/**` from push checks and
reserve that prefix for Dependabot. Avoid creating duplicate writer PRs.

Check runs on non-main branch pushes, pull requests, and non-main manual
requests. Test is manual/main-only and runs `check:all` before `test:all` via
`--mode before`; only Check / All is required for landing. Job names are
Check/All, Test/All, Plan/Infrastructure, and Apply/Infrastructure. Continuous batched
Test, failure bisect, revert/fix-forward preparation, and human escalation are
a TODO, not implemented automation. Do not add a separate Build just to warm
caches; the old Build realized its environment and ran tests, not every export.

#security [[factory-production-flake-source]]
Production bootstrap must use Git-aware `nix run .#devenv-cli`, not `path:.`.
A synthetic validation showed `path:.` includes ignored credential, backend,
and saved-plan files in the Nix source, while Git-aware inputs exclude them.
Keep runtime credential files ignored and unstaged; never publish them or state
through Cachix. Do not rerun an installation's Day 0 bootstrap as reconciliation.

#decision [[factory-member-landing]]
Do not port the old `member_landing` ruleset. It blocked normal green merges;
the user approved its removal in favor of existing write permissions plus
independent branch protection. Preserve signed commits, required checks,
linear history, and no-force-push/deletion protections. Do not use bypasses to
work around ordinary landing failures.

## Inputs and dependency updates

#decision [[factory-moving-flake-refs]]
Moving upstream branches in `flake.nix` are frozen by committed `flake.lock` and
`devenv.lock`. Consumers own their lock graphs and may explicitly override or
follow inputs. Dependabot proposes Actions, npm/pnpm, OpenTofu, and Nix updates;
it does not automatically land changes. Its Nix updater does not update
`devenv.lock`, and grouping does not guarantee an atomic CLI/module update.
Review and synchronize both locks. The CLI/module revision guard and
`check-devenv-locks --git-index` in CI prevent an automatic working-copy repair
from hiding committed lock drift. Keep CODEOWNERS and a regular committed
Dependabot file; the optional native template uses `files.copyMode = "seed"`.

## Runner and cache policy

#decision [[factory-namespace-profiles]] [[factory-cache-locality]]
As of `68d2a20` (2026-10-17), all four Factory workflows use
`namespace-profile-quantile-4x8`, superseding the earlier 8x16 selection.
Check is 10 minutes; Test/Plan/Apply are 20 minutes. Preserve Restricted runtime
access, the 20 GiB Nix volume, provider-enforced main-only commits, and separate
profile/repository cache identities. Do not change other repositories' profiles
or silently share their caches.

Namespace volumes are best-effort node-local caches. Successful publication and
restoration were both verified, but later jobs can miss because a suitable
parent is unavailable on their assigned node. The cache action's `/nix: cached`
message alone is not proof of restoration. Preallocated runners may attach
before an earlier job publishes; sequential dispatch does not guarantee reuse.
Inspect lineage before assuming broken publication or insufficient capacity.
Do not clear shared caches or contact the provider without authorization.

#decision [[factory-cachix-policy]]
All four workflows read the approved public caches: devenv, Quantile, Numtide,
Cachix, pre-commit-hooks, and go-overlay, using their published signing keys.
These settings are workflow-local, not automatically inherited by downstream
flakes or an untrusted local daemon. Check does not publish. Test, Plan, and
Apply publish only on main through the pinned Cachix action's standard store
scan (`useDaemon: false`), not a custom task or root collector. The scan uploads
newly added paths, not every restored path; caches are not guaranteed mirrors.
`useDaemon: false` describes uploading, not Nix build-daemon configuration.

Cache credentials are runtime-only and must not enter Terraform state, source,
or the Nix store. Main-only publishing conditions are not a general credential
boundary: an organization secret is not inherently main-only. Writers sharing
a cache form a supply-chain trust boundary. Compromise recovery must address
credentials and already-restored copies, not only remote cache contents or a
recipe change. Never run Plan/Apply merely to warm caches.

## Fork approval and tests

#decision [[factory-fork-approval]] [[factory-terraform-tests]]
`tf/modules/project/github` unconditionally declares `all_external_contributors` workflow
approval, including returning contributors; do not add an opt-in. GitHub's
membership exemptions still apply, and approval does not itself grant fork
jobs repository secrets. The REST API provider was selected because the
reviewed GitHub provider lacked this setting. Keep caller-owned runtime bearer
authentication, the reviewed registry source/lock, and non-mutating removal of
the remote approval policy. Local validation covered drift and saved-plan repair
without storing the bearer. Extend real-source Rego checks and behavior-focused
Vitest tests, not parallel mock frameworks or tests of fixed literals.

Source is merged, but approval-policy production reconciliation remains pending
as of this review. Last observed live policy was `first_time_contributors`;
inspect a separately authorized Plan before Apply and pause on unrelated changes.

## QMD mitigation

#implementation [[factory-ci-stall]] [[factory-cachix-policy]]
On 2026-10-17, one reproduced stall was confirmed as a fork-inherited Nix
interrupt-callback mutex deadlock, matching NixOS/nix#16581. This does not prove
every historical timeout had that cause. The user rejects a maintained Nix
fork/backport. No usable fixed upgrade or known-safe downgrade was established
in that dated audit; changing standalone Nix alone does not replace the library
embedded in devenv. Recheck upstream status before recommending a future fix.

Commit `68d2a20` makes `nix/qmd.nix` reconstruct bun2nix with upstream
llm-agents' own nixpkgs and ordinary external `fetchurl` builders. This avoids
QMD's known builtin-fetcher route while preserving cached output identities;
it is not a global Nix fork-safety repair. All 303 tarball derivations were
forcibly rebuilt successfully on x86_64-linux. QMD output equality was evaluated
on x86_64-linux, aarch64-linux, and aarch64-darwin; the latter systems were not
built. Pi already uses external npm-based packaging.

The exact-head Check and subsequent ordinary main Test/cache verification
passed, including fresh public QMD publication. No HTTP, retry, sandbox,
privilege, or Nix-fork tuning landed. Pinned devenv still sets HTTP connections
to 100 in its embedded backend; standalone CLI settings can show 25. The reason
for the different local/Namespace failure frequency remains unresolved.
Diagnostic instrumentation was not merged; original diagnostic branches and
large temporary traces were removed, with compact findings retained privately.

## Remaining migration scope

#decision [[factory-old-devenv]]
Review old source directories individually, with user approval before each
port. The old Update workflow and its policy harness are superseded by
Dependabot and current checks. Do not port the old Build merely for caching.
Top-level `tf/` was reviewed; old `devenv/tf/` is a distinct pending directory.
The pending inventory includes old
`devenv/{c,checkov,duckdb,editorconfig,gcp,git,github,go,json,k8s,keep-sorted,logs,markdown,nix,opa,postgres,prettier,protobuf,python,semgrep,shell,tf,toml,trivy,ts,typos,vale,wasm,yaml}/`.
`secretspec.toml` and `devenv/secrets/` were reviewed and selectively ported.
Existing tool modules do not mean the remaining directories were all reviewed.
Consumer integrations and unrelated infrastructure migrations remain separate.

<!-- 2026-10-17 20:43:40 [01a14275] -->

#preference [[factory-test-value]]
Tests must have clear regression-detection value. Avoid overengineered harnesses, tautological assertions, and tests that merely restate known configuration values or upstream behavior. Prefer small behavior-focused tests of Factory-owned boundaries; changing test frameworks alone does not replace meaningful coverage.

<!-- 2026-10-17 22:29:18 [01a14275] -->
#decision [[factory-secretspec]]
The user approved implementing `etc/secretspec/secretspec.toml` plus `nix/secretspec/default.nix`, preserving automatic runtime export to ordinary shells/tasks, with no scopes. Default/check stay credential-free; test/plan/apply require the Cachix publication token explicitly passed by those workflow steps. Factory selects the store-backed native manifest through `SECRETSPEC_FILE`; no root link, seeding, bootstrap bypass, or missing-file skip is needed. Native Devenv evaluation-time SecretSpec resolution stays disabled. Only declarations/code enter Nix outputs, never resolved values. Downstreams can override the manifest or eject to a seeded, committed root manifest and remove the file override for native discovery. Relative file-provider routes are relative to the manifest; store-backed declarations need absolute file-provider paths. File-valued `as_path` lifetime handling remains deferred. The runtime loader remains explicit opt-in wiring, not a side effect of importing Factory modules. Native `secretspec run` is not equivalent to transparent task inheritance; historical selection of the exporter was deliberate, not evidence that run was broken.

<!-- 2026-10-17 23:06:07 [01a14275] -->
#decision [[factory-check-fix]]
Use Biome for the current lint/format implementation; retain tsc for TypeScript checking. The user chose Biome after comparing ESLint/TypeScript 7, Oxlint/Oxfmt, Ultracite, and React Doctor. Do not add those alternatives or automatic fixing hooks. Keep native package.json check/fix scripts, reusable native configuration under etc/, source-preserving check:all, and explicit fix:all.


<!-- 2026-10-18 00:46:09 [01a14275] -->
#decision [[factory-production-guards]] [[factory-saved-plans]]
Saved-plan source and deployment skills landed on main at ffad1eae4cd6c77fed6c19aba33eb47b69c97340 (2026-10-18); branch Check, main Test and the first Plan succeeded. Apply has not yet been exercised. Plan stores sensitive contents in private GCS and publishes a one-day GitHub receipt. Apply selects its artifact ID, validates the original successful producer attempt, repository, current main SHA, 24-hour age, backend and digests, then applies without replanning using the receipt's GCS generation. Lifecycle cleanup is asynchronous, separate from validity. Retain manual protected-main, actor/triggering-actor maintainer gates, prod, WIF, backend locks and shared non-cancelling concurrency. A merge or green Check authorizes neither production workflow. Operators need an authorized private plan-read route after bootstrap Owner removal; never silently broaden IAM.

#preference [[factory-saved-plans]] [[factory-config-layout]]
Keep implementation in flat nix/tf.nix, with shared internal GitHub/GCS functions. No Python, separate helper files, dedicated test file or new test framework for this change. Keep authorization, stock artifact-upload and post-upload always-cleanup in CI. Use simple Plan/Apply step names and parallel option descriptions; avoid repeated "reviewed" labels. Explain implementation/storage choices beside Nix logic rather than in workflow comments. Avoid overengineering, overtesting and redundant validation.

#decision [[factory-deploy-skills]]
Operational instructions live in .pi/skills/day-zero-deploy and deploy, replacing tf/README.md. Preserve bootstrap operations and removal of only the bootstrap human's direct Owner grant after CI handoff, verifying private plan-read and recovery access first. Keep standing projectCreator/billing.user and CI/WIF grants. Never reseed an existing installation. Each dispatch, mutation, migration and retry needs separate approval.

<!-- 2026-10-18 00:57:29 [01a14275] -->
#decision [[factory-plan-readers]] [[factory-saved-plans]]
The user approved Terraform-managed plan-reader access via a required gcp_maintainers set of Google account emails, separate from gh_maintainers. GCP_MAINTAINERS maps to TF_VAR_gcp_maintainers in Plan/Apply and is required by their SecretSpec profiles. Each account gets a non-authoritative bucket IAM member binding for roles/storage.objectViewer conditioned on the plans/ object prefix; no state, bucket-wide listing or project administration access. Do not make manual IAM grants or restore human Owner. Implementation is locally validated on feat/gcp-maintainer-plan-access, not yet committed/applied; the repository variable is configured for the approved operator. Existing installations still require an already-authorized reader to inspect the first access-grant plan before Apply.

<!-- 2026-10-18 01:50:21 [01a14275] -->
#decision [[factory-terraform-layout]] [[factory-test-value]]
Factory's deployment root is tf/infrastructure; reusable modules are tf/modules/project/github and tf/modules/project/gcp. Root inputs/outputs retain gh_/gcp_ prefixes; child interfaces omit them. The root manages GitHub once and passes repository/maintainer IDs to GCP; additional GCP instances do not require a GitHub provider. No management boolean or compatibility/moved blocks. Existing module.project state needs a separately approved one-time migration to module.github/module.gcp without changing the bucket or repository/prod prefix.

Keep TF_DIR task-scoped: check:all, plan:infrastructure and apply:infrastructure use tf/infrastructure; fix:all uses tf. Shared tools default to tf. SECRETSPEC_FILE remains beside enterShell because secret loading precedes task environments. Tests live beside their modules/root, with no shared test-helpers framework or tautological assertions: retain independent consumer smoke checks and the scoped scanner-exception regression. README Skills follows Development and uses the Q1 invocation format.