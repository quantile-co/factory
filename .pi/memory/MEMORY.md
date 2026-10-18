# Project memory

Source, tests, current workflows, and the root `AGENTS.md` take precedence over
historical notes. Keep only reviewed, repository-specific knowledge here.
Never commit credentials, customer data, provider payloads, state, saved plans,
local backend overrides, raw transcripts, scratchpad, or recovery data.

#preference [[factory-memory-publication]]
Review and sanitize MEMORY.md and daily-log updates, then stage and commit them
with the other changes; this is required, not optional. Do not defer them as
“unrelated” or leave them for an unspecified next commit. Check every Factory
worktree before declaring completion and reconcile unique publishable history.
No separate approval is required. Commit post-CI/deployment outcomes in a follow-up
when necessary, without generating another dirty note about that commit itself.
Scratchpad, raw recovery and sensitive material remain excluded. While a saved
plan pins main, commit memory on a branch without advancing main until the
deployment is resolved.

## Configuration and tool boundaries

#decision [[factory-config-layout]] [[factory-executable-config]]
Factory is a shared Nix flake, not a shared devenv configuration. Keep reusable
native-format assets under `etc/`, separate from `nix/`. Downstream repositories
choose whether to copy, patch, generate, or link those assets and where to put
them. Do not encode elaborate mergeable tool configurations in Nix or force
placement. Use a uniform `nix/<tool>/default.nix` layout even for small modules, with a colocated `default.test.ts` containing at least one meaningful smoke or consumer test. Keep individual implementations in one file unless they genuinely need more.

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

## Local validation

Use this checkout's pinned direnv shell. Source checks do not rewrite files;
fixing is explicit and safe. The task entry points are:

```sh
devenv tasks run --show-output check:all
devenv tasks run --show-output --mode before test:all
devenv tasks run --show-output --mode before fix:all
```

For tests without rerunning checks, use `--mode single test:all`. Backend-free
Terraform validation uses `tofu -chdir=tf fmt -check -recursive`, then
`tofu -chdir=tf/infrastructure init -backend=false -input=false -lockfile=readonly`
and `tofu -chdir=tf/infrastructure validate`. `nix flake check .` checks the flake;
`nix run .#devenv-cli -- tasks run ...` selects the pinned CLI explicitly. New
source files must be added to Git before Git-aware evaluation can see them.

Biome's native template is `etc/biome/default.json`, exposed as
`quantile.ts.biome.configFile` and linked to `biome.json` by Devenv. Consumers own
placement and scripts. Both project scripts use the same file selection and
exclude READMEs and unrelated native fixtures; fixing never enables `--unsafe`.
The root task checks source policies, types and formatting; colocated Vitest tests
exercise backend-free consumers. Provider/CLI versions remain in source and locks,
not copied into this guide.

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
All local/CI checks and workflow bootstrap must use Git-aware flake references
(`nix flake check .`, `nix run .#devenv-cli`), not `path:.`. A synthetic validation
showed `path:.` includes ignored credential, backend and saved-plan files in the
Nix source, while Git-aware inputs exclude them. The final audit also extended
this protection to ignored recovery data and indexes. Credential-free synthetic
consumer fixtures may still use path inputs.
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
Dependabot file. Factory's `etc/github/dependabot.yml` is authoritative;
Devenv `copyMode = "copy"` refreshes `.github/dependabot.yml` on shell entry.
Commit both files together. `check:all` compares the Git-indexed root file to
the native template, so a working-copy repair cannot conceal missing commits.

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

The approval policy was reconciled by approved saved-plan Apply 39111226816 on
2026-10-18. A subsequent API read confirmed `all_external_contributors` live.
Future changes still require a separately authorized Plan review and Apply.

## QMD mitigation

#implementation [[factory-ci-stall]] [[factory-cachix-policy]]
On 2026-10-17, one reproduced stall was confirmed as a fork-inherited Nix
interrupt-callback mutex deadlock, matching NixOS/nix#16581. This does not prove
every historical timeout had that cause. The user rejects a maintained Nix
fork/backport. No usable fixed upgrade or known-safe downgrade was established
in that dated audit; changing standalone Nix alone does not replace the library
embedded in devenv. Recheck upstream status before recommending a future fix.

Commit `68d2a20` makes `nix/qmd/default.nix` reconstruct bun2nix with upstream
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
`devenv/{git,github,go,json,k8s,keep-sorted,logs,markdown,nix,opa,postgres,prettier,protobuf,python,semgrep,shell,tf,toml,trivy,ts,typos,vale,wasm,yaml}/`.
`devenv/{c,checkov,duckdb,editorconfig,gcp}/`, `secretspec.toml` and `devenv/secrets/` were reviewed and selectively ported.
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
Saved-plan source and deployment skills landed on main at ffad1eae4cd6c77fed6c19aba33eb47b69c97340 (2026-10-18); branch Check, main Test and the first Plan succeeded. The approved Factory saved-plan Apply 39111226816 succeeded using artifact 12130102012 on 6ffb6f3; Q0's approved no-op Apply 39109793857 also succeeded. Plan stores sensitive contents in private GCS and publishes a one-day GitHub receipt. Apply selects its artifact ID, validates the original successful producer attempt, repository, current main SHA, 24-hour age, backend and digests, then applies without replanning using the receipt's GCS generation. Lifecycle cleanup is asynchronous, separate from validity. Retain manual protected-main, actor/triggering-actor maintainer gates, prod, WIF, backend locks and shared non-cancelling concurrency. A merge or green Check authorizes neither production workflow. Operators need an authorized private plan-read route after bootstrap Owner removal; never silently broaden IAM.

#preference [[factory-saved-plans]] [[factory-config-layout]]
Keep saved-plan implementation in one nix/tf/default.nix, with shared internal GitHub/GCS functions. No Python, separate saved-plan helper files, dedicated test file or new test framework for this change. Keep authorization, stock artifact-upload and post-upload always-cleanup in CI. Use simple Plan/Apply step names and parallel option descriptions; avoid repeated "reviewed" labels. Explain implementation/storage choices beside Nix logic rather than in workflow comments. Avoid overengineering, overtesting and redundant validation.

#decision [[factory-deploy-skills]]
Operational instructions live in .pi/skills/day-zero-deploy and deploy, replacing tf/README.md. Preserve bootstrap operations and removal of only the bootstrap human's direct Owner grant after CI handoff, verifying private plan-read and recovery access first. Keep standing projectCreator/billing.user and CI/WIF grants. Never reseed an existing installation. Each dispatch, mutation, migration and retry needs separate approval.

<!-- 2026-10-18 00:57:29 [01a14275] -->
#decision [[factory-plan-readers]] [[factory-saved-plans]]
The user approved Terraform-managed plan-reader access via a required gcp_maintainers set of Google account emails, separate from gh_maintainers. GCP_MAINTAINERS maps to TF_VAR_gcp_maintainers in Plan/Apply and is required by their SecretSpec profiles. Each account gets a non-authoritative bucket IAM member binding for roles/storage.objectViewer conditioned on the plans/ object prefix; no state, bucket-wide listing or project administration access. Do not make manual IAM grants or restore human Owner. Source, including the project module split, landed on protected main at d2f61f13de29e7a5ab0fa474b224a3af3d66832e with branch Check 39109215326 and main Test 39109335096 passing. The repository variable is configured for the approved operator, and the state-address migration succeeded in guarded run 39110692702. Access-grant Apply 39111226816 succeeded with approved receipt artifact 12130102012. Direct GCS download as the approved Google user was verified against the reviewed plan digest. The encrypted CI handoff was used only to inspect this initial grant plan; normal private GCS review now works. Existing installations still require an already-authorized reader to inspect the first access-grant plan before Apply.

<!-- 2026-10-18 01:50:21 [01a14275] -->
#decision [[factory-terraform-layout]] [[factory-test-value]]
Factory's deployment root is tf/infrastructure; reusable modules are tf/modules/project/github and tf/modules/project/gcp. Root inputs/outputs retain gh_/gcp_ prefixes; child interfaces omit them. The root manages GitHub once and passes repository/maintainer IDs to GCP; additional GCP instances do not require a GitHub provider. No management boolean or compatibility/moved blocks. Factory's module.project state was migrated to module.github/module.gcp in guarded run 39110692702, preserving resource identities, attributes, providers and outputs. The bucket and repository/prod prefix did not change. Do not repeat the migration; other existing installations need their own reviewed migration.

Plan/apply tasks keep TF_DIR=tf/infrastructure. Check/fix tasks have no task-wide TF_DIR: devenv.nix declares terraformSourceDir for one recursive formatting check/fix and terraformRoots for independent backend-free initialization/validation, passing TF_DIR per tool invocation. The reusable root checker no longer checks formatting. Shared tools default to tf. SECRETSPEC_FILE remains beside enterShell because secret loading precedes task environments. Tests live beside their modules/root, with no shared test-helpers framework or tautological assertions: retain independent consumer smoke checks and the scoped scanner-exception regression. README Skills follows Development and uses the Q1 invocation format.

<!-- 2026-10-18 02:10:48 [01a14275] -->
#preference [[factory-task-descriptions]]
Task descriptions should state intent, not tool names or implementation details that may change. Use “Run all fixes.” for fix:all and “Run all tests.” for test:all; dependencies still determine execution order.


<!-- 2026-10-18 03:15:47 [01a14275] -->
#preference [[factory-agent-guide]]
AGENTS.md must remain a lightweight navigational resource: point to source, tasks, skills and the required project-memory entry point. Persist repository rules, durable decisions, preferences and operational context in memory rather than expanding or duplicating them in AGENTS.md. Dated logs record history; current source and curated memory distinguish current decisions from superseded steps.

<!-- 2026-10-18 12:30:29 [01a14275] -->
#decision [[factory-clang]] [[factory-config-layout]] [[factory-test-value]]
Reviewed old `devenv/c/` implementation and tests, then selectively ported it to opt-in `nix/c/default.nix` and native templates `etc/clang/{.clang-format,.clang-tidy}`. Keep LLVM/4-space/100-column formatting and analyzer/bugprone/performance/portability tidy checks with analyzer/bugprone errors. Reusable packages expose Clang tools plus optional Bear/CMake/Meson/Ninja/pkg-config and Linux GDB/Valgrind, read-only format and compilation-database-backed tidy checks, and explicit format fixes. They select tracked, regular non-binary C/C++ source (headers only for formatting), skip build/vendor/third_party and accept caller exclusions, selected paths, native config overrides and compilation-database directory at runtime. Missing database/selected translation unit entry fails; compilation flags and database generation remain consumer-owned. Importing the module installs no hooks, starts no tool, and adds no tasks: downstreams decide when to install/register/execute checks/fixes. Do not bake Factory's `etc/clang/` paths into reusable executables or rebuild the old generated Prek hook configuration, Nix YAML settings or root Python/Nix harness.

#preference [[factory-module-layout]]
Use `nix/<module>/default.nix` and a colocated `default.test.ts` for each reusable module. One simple, meaningful smoke/consumer test per small module is fine; avoid tautological configuration snapshots and shared helper frameworks. Root `nix/default.nix` is the flake aggregate. `nix/devenv/default.nix` exports Devenv packages and a separate opt-in `devenvModules.files` compatibility module; it is not part of the reusable tool-module aggregate. Existing flake consumer smoke test belongs under `nix/github/default.test.ts`. Moving it leaves no root `*.ts`; the Biome project check/fix selectors must not pass a nonmatching root glob.

<!-- 2026-10-18 13:10:33 [01a14275] -->
#decision [[factory-native-config]] [[factory-checkov]] [[factory-semgrep]]
Downstreams customize tool behavior by generating or patching native files under their control, not by passing tool settings through Nix options, generated files, or dynamically assembled CLI flags. Keep module wrappers small: select caller-native config at runtime and retain only required execution/safety validation. Do not write explanatory boilerplate such as “consumers choose where to install and patch it” in option descriptions; explain only non-obvious behavior.

Checkov's opt-in `nix/checkov/default.nix` keeps the hash-pinned isolated Checkov 3.2.527 package (to avoid the primary package set's insecure ecdsa closure) and exposes `etc/checkov/.checkov.yaml` as an optional native template. The consuming repository owns scan directories, frameworks, CKV/CKV2 check and skip IDs, output modes, and no-download/no-upload settings in that file. A standalone read-only checker loads `.checkov.yaml`/`.checkov.yml` at the Git root or `CHECKOV_CONFIG_FILE`, rejects missing/nonexistent roots, empty frameworks, severity-based checks and enabled metadata/module downloads or result uploads, then invokes Checkov with the native config. Validation matters: pinned Checkov silently skips missing roots and `check: [HIGH]` can succeed without running local checks when platform metadata is unavailable. The wrapper unsets inherited Python paths to prevent mixing its Python 3.13 closure with the caller's Python. Importing the module installs no tools/hooks/tasks. No Checkov check is active on Factory's source.

#decision [[factory-duckdb]]
Old `devenv/duckdb` only installed an overridable CLI when enabled, ran a version smoke on `enterTest`, and added no tasks or database. Factory's opt-in `nix/duckdb/default.nix` exposes the overridable `quantile.duckdb.package` without installing it or creating a database on import. Its single colocated consumer test runs the version smoke, an in-memory SQL query, a real package override and checks for no project files. The old `enable` gate is replaced by explicit consumer installation; `enterTest` is not registered implicitly. No inline tool policy or CLI settings existed to move into an `etc/` asset.

#decision [[factory-gcp]]
Old `devenv/gcp` opt-in installed an overridable `pkgs.google-cloud-sdk` and ran credential-free `gcloud --version` on enterTest with telemetry and component-update checks disabled. It had no tasks, cloud operations, project/ADC setup, or tool-policy/config data to migrate into `etc/`; Google's native SDK config is a caller-owned writable authentication/project profile, not an appropriate static Factory template for two smoke-test flags. Factory's existing `quantile.gcp.gcloud.package` already exposes the same overridable package without implicit installation; Factory explicitly installs it in its own Devenv shell. Its colocated consumer test now exercises the real pinned `gcloud --version` in an isolated HOME/CLOUDSDK_CONFIG with the old noninteractive/telemetry/update guards and verifies no ADC file is created; it retains the actual package-override smoke. No new module wrapper, static asset, hooks, or automatic cloud actions are warranted.

#decision [[factory-editorconfig]]
Old `devenv/editorconfig` mixed read-only checker hooks, Nix-generated checker exclusions and a Nix-generated, manual-only Prek EOF fixer. Factory retains the consumer-owned native `etc/editorconfig/.editorconfig` and offers `etc/editorconfig/.editorconfig-checker.json` for native regex exclusions (including its tracked `devenv.lock`, which need not end in a newline). The opt-in `nix/editorconfig/default.nix` exposes native config paths and separate read-only check / explicit EOF-fix packages. They select tracked regular text files from the Git root, skip binaries, symlinks and untracked files, and use the same native exclusion list; a missing `.editorconfig` fails checks. The fixer invokes pinned `end-of-file-fixer` only when explicitly run, repeats after its rewrite exit 1 and propagates other failures, so a successful rewrite does not block later consumer fixes. Importing the module installs neither tools nor hooks/tasks; orchestration stays consumer-owned. The focused test covers actual checker diagnostics, no mutation on check, scoped fixes, missing native config and a failing fixer. No generated Prek config or duplicate Nix exclusion options.

Semgrep's native policy is `etc/semgrep/rules/` and its ignore template is `etc/semgrep/.semgrepignore`, linked at Factory's root and excluded from Git there. The Devenv `.semgrep` directory link points at `rules/` only, so edits to its sibling ignore template do not change the linked directory's store path. `nix/semgrep/default.nix` still explicitly tests local rules and fails on source findings with metrics disabled, but no longer constructs `--exclude` arguments or uses `SEMGREP_FIXTURES_DIR`. Pinned Devenv's `files` implementation has an independent directory-symlink update bug (`ln -sf` follows an existing link to a directory). Factory explicitly imports `devenvModules.files` from `nix/devenv/default.nix`: a generic task after `devenv:files:cleanup` and before `devenv:files` removes only changed directory symlinks backed by the Nix store and recorded in Devenv's managed-files state. Devenv then recreates them; correct links and copy/seed entries are untouched. New directory declarations are covered automatically, without patching/forking upstream or enumerating leaf files. The link briefly disappears between tasks; this is not cross-process locking. Use Nix path interpolation for the desired `file` target, not `toString`, so it matches Devenv's materialized store path. The user rejected an upstream patch and a checked-in relative link. Per-file Semgrep fixture symlinks were experimentally rejected by Semgrep with misleading success status; retain the directory link with regular fixture files beneath it. Evidence: https://github.com/higherorderfunctor/nix-agentic-tools/issues/2229 and the historical merged guard in https://github.com/higherorderfunctor/nix-agentic-tools/pull/2223. Full consumer coverage is colocated at `nix/devenv/default.test.ts`. Other Nix modules were reviewed: Clang/Biome/Actionlint/EditorConfig/Pi/QMD/SecretSpec already use native assets, while Terraform's remaining flags enforce execution and saved-plan safety, not tool policy. Package-only DuckDB/GCP/JSON need no asset.