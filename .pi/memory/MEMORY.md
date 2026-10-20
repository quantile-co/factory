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

#decision [[declared-runtime-dependencies]]
Factory, `.github` and the public application must declare every required CLI
and native runtime dependency through pinned Devenv/Nix inputs or locked
language-level packages. A passing run that uses host PATH tools, global
packages, system libraries or an undeclared browser/emulator cache is not
proof of a complete environment. Audit development, checks, tests, builds and
explicit deployment/provider commands; validate with restricted executable
search paths and isolated caches. Keep Nix/direnv bootstrap prerequisites
explicit. Do not change assertions or skip tests to hide missing dependencies.
Expose tools as small individual Factory modules; consumers explicitly select
them in `devenv.nix`. Do not introduce purpose-specific tool bundles such as a
separate release shell. A custom workflow should use the consumer's existing
pinned environment from trusted source before processing a candidate revision.

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

#decision [[devenv-task-discovery]]
The first-party `devenv-tasks` skill discovers task descriptions and actual
implementations from each project's configuration and CLI capabilities. Keep it
generic across Devenv projects: no fixed task inventory, Factory deployment
assumptions or required credential profile. Follow imports, overrides and
referenced executables; inspect dependencies without executing task bodies.
Consumers link it explicitly. Do not list it in the public app README.

#decision [[ci-cold-closure-timeout]]
Shared Check and Test jobs allow 15 minutes for cold or partially cached Nix
closures. The user approved raising the former 10-minute budget after app Checks
expired during dependency downloads, before checks started. Do not remove the
bound or weaken checks, cache signatures or deployment guards to accommodate it.

#implementation [[factory-consumer-check-helpers]]
`quantile.playwright.withVersion` returns the configured browser only when its
client version matches the consumer's exact npm version. Keep this selection in
the consumer's package list, not a recursive module-wide assertion. With no
arguments, `check-devenv-locks` checks the conventional `factory` input in
`flake.lock` and `devenv.lock`, including Git-index validation in CI. Explicit
arguments remain supported for Factory's own different lock layout.

Local Check and all 112 tests passed. One full run reproduced the previously
observed Taplo missing-schema diagnostic failure; unchanged focused and full
reruns passed. No assertion or test was removed. README development instructions
now start with explicit hook installation and separate Checks and Tests.

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
`quantile.biome.configFile` and linked to Factory's `biome.json`.
Factory's explicit check/fix scripts exclude unrelated fixtures and never enable
`--unsafe`; colocated Vitest tests exercise backend-free consumers.

## Workflow and production boundaries

#decision [[factory-workflow-boundary]] [[factory-check-events]]
Keep workflows thin wrappers around Nix-backed tasks. Use Actionlint and real
Check runs; do not add tests that merely repeat YAML literals, action pins, or
third-party behavior. Avoid overengineering and low-value tests; prefer focused
behavioral regressions over simulated external-service lifecycles. Keep only a
root `AGENTS.md`. README edits require explicit approval.

Keep Factory's primary checkout and root Herdr workspace on `main`. Isolate
ongoing feature changes in linked worktrees rather than switching the root
checkout to a feature branch.

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
Dependabot file. Factory's `etc/dependabot/dependabot.yml` is authoritative;
Devenv `copyMode = "copy"` refreshes `.github/dependabot.yml` on shell entry.
Commit both files together. `check:all` compares the Git-indexed root file to
the native template, so a working-copy repair cannot conceal missing commits.

## Runner and cache policy

#decision [[factory-namespace-profiles]] [[factory-cache-locality]]
As of `68d2a20` (2026-10-17), all four Factory workflows use
`namespace-profile-quantile-4x8`, superseding the earlier 8x16 selection.
Check and Test are 10 minutes; Plan and Apply are 20 minutes. Preserve Restricted runtime
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
CI's broader cache list is workflow-local, not automatically inherited by downstream
flakes or an untrusted local daemon. Factory and the organization consumer select
`quantile-co`, `cachix`, `pre-commit-hooks`, and `go-overlay` through Devenv's
`cachix.pull`; Devenv already adds its own cache. This does not guarantee daemon
acceptance for untrusted users or affect the `.envrc` Nix bootstrap before
Devenv starts. Numtide's `cache.numtide.com` is not a `*.cachix.org` cache name;
its URL and public key are set through public `NIX_CONFIG` values in each
consumer's `.envrc`, after the CLI bootstrap and before `use devenv`, rather
than a fake `cachix.pull` name. Direct Devenv invocations outside direnv and
untrusted local daemons retain the documented limitations. Check does not publish. Test, Plan, and
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
Top-level `tf/` and the distinct old `devenv/tf/` were reviewed separately.
All old `devenv/{c,checkov,duckdb,editorconfig,gcp,git,github,go,json,k8s,keep-sorted,logs,markdown,nix,opa,postgres,prettier,protobuf,python,semgrep,shell,tf,toml,trivy,ts,typos,vale,wasm,yaml}/` directories, `secretspec.toml`, and `devenv/secrets/` have been reviewed and selectively ported. The consuming `devenv.nix` still needs its final execution audit against old hook, LFS, tool, task, fix, and test behavior. Downstream migrations and unrelated infrastructure work remain separate.

<!-- 2026-10-17 20:43:40 [01a14275] -->

#preference [[factory-test-value]]
Tests must have clear regression-detection value. Avoid overengineered harnesses, tautological assertions, and tests that merely restate known configuration values or upstream behavior. Prefer small behavior-focused tests of Factory-owned boundaries; changing test frameworks alone does not replace meaningful coverage.

<!-- 2026-10-17 22:29:18 [01a14275] -->
#decision [[factory-secretspec]]
The user approved implementing `etc/secretspec/secretspec.toml` plus `nix/secretspec/default.nix`, preserving automatic runtime export to entered Devenv shells, with no scopes. Bare `devenv tasks run` does not execute `enterShell`; a workflow must enter the shell before expecting this loader. Default/check stay credential-free; test/plan/apply require the Cachix publication token explicitly passed by those workflow steps. Factory selects the store-backed native manifest through `SECRETSPEC_FILE`; no root link, seeding, bootstrap bypass, or missing-file skip is needed. Native Devenv evaluation-time SecretSpec resolution stays disabled. Only declarations/code enter Nix outputs, never resolved values. Downstreams can override the manifest or eject to a seeded, committed root manifest and remove the file override for native discovery. Relative file-provider routes are relative to the manifest; store-backed declarations need absolute file-provider paths. File-valued `as_path` lifetime handling remains deferred. The runtime loader remains explicit opt-in wiring, not a side effect of importing Factory modules. Native `secretspec run` is not equivalent to transparent task inheritance; historical selection of the exporter was deliberate, not evidence that run was broken.

<!-- 2026-10-17 23:06:07 [01a14275] -->
#decision [[factory-check-fix]]
Use Biome for the current lint/format implementation; retain tsc for TypeScript checking. The user chose Biome after comparing ESLint/TypeScript 7, Oxlint/Oxfmt, Ultracite, and React Doctor. Do not add those alternatives or automatic fixing hooks. Keep native package.json check/fix scripts, reusable native configuration under etc/, source-preserving check:all, and explicit fix:all.

<!-- 2026-10-18 00:46:09 [01a14275] -->
#decision [[factory-production-guards]] [[factory-saved-plans]]
Saved-plan source and deployment skills landed on main at ffad1eae4cd6c77fed6c19aba33eb47b69c97340 (2026-10-18); branch Check, main Test and the first Plan succeeded. The approved Factory saved-plan Apply 39111226816 succeeded using artifact 12130102012 on 6ffb6f3; Q0's approved no-op Apply 39109793857 also succeeded. Plan stores sensitive contents in private GCS and publishes a one-day GitHub receipt. Apply selects its artifact ID, validates the original successful producer attempt, repository, current main SHA, 24-hour age, backend and digests, then applies without replanning using the receipt's GCS generation. Lifecycle cleanup is asynchronous, separate from validity. Retain manual protected-main, actor/triggering-actor maintainer gates, prod, WIF, backend locks and shared non-cancelling concurrency. A merge or green Check authorizes neither production workflow. Operators need an authorized private plan-read route after bootstrap Owner removal; never silently broaden IAM.

#preference [[factory-saved-plans]] [[factory-config-layout]]
Keep saved-plan implementation in `nix/opentofu/default.nix`, with shared internal GitHub/GCS functions. No Python, separate saved-plan helper files, dedicated test file or new test framework for this change. Keep authorization, stock artifact-upload and post-upload always-cleanup in CI. Use simple Plan/Apply step names and parallel option descriptions; avoid repeated "reviewed" labels. Explain implementation/storage choices beside Nix logic rather than in workflow comments. Avoid overengineering, overtesting and redundant validation.

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
Use `nix/<tool>/default.nix` and a colocated `default.test.ts` for each reusable tool module. One simple, meaningful smoke/consumer test per small module is fine; avoid tautological configuration snapshots and shared helper frameworks. Root `nix/default.nix` is the flake aggregate. `nix/devenv/default.nix` exports Devenv packages and a separate opt-in `devenvModules.files` compatibility module; it is not part of the reusable tool-module aggregate. Keep the flake's consumer smoke test in `flake.test.ts`; root checks should select existing files.

<!-- 2026-10-18 13:10:33 [01a14275] -->
#decision [[factory-native-config]] [[factory-checkov]] [[factory-semgrep]]
Downstreams customize tool behavior by generating or patching native files under their control, not by passing tool settings through Nix options, generated files, or dynamically assembled CLI flags. Keep module wrappers small: select caller-native config at runtime and retain only required execution/safety validation. Do not write explanatory boilerplate such as “consumers choose where to install and patch it” in option descriptions; explain only non-obvious behavior.

Checkov's opt-in `nix/checkov/default.nix` keeps the hash-pinned isolated Checkov 3.2.527 package (to avoid the primary package set's insecure ecdsa closure) and exposes `etc/checkov/.checkov.yaml` as an optional native template. The consuming repository owns scan directories, frameworks, CKV/CKV2 check and skip IDs, output modes, and no-download/no-upload settings in that file. A standalone read-only checker loads `.checkov.yaml`/`.checkov.yml` at the Git root or `CHECKOV_CONFIG_FILE`, rejects missing/nonexistent roots, empty frameworks, severity-based checks and enabled metadata/module downloads or result uploads, then invokes Checkov with the native config. Validation matters: pinned Checkov silently skips missing roots and `check: [HIGH]` can succeed without running local checks when platform metadata is unavailable. The wrapper unsets inherited Python paths to prevent mixing its Python 3.13 closure with the caller's Python. Importing the module installs no tools/hooks/tasks. No Checkov check is active on Factory's source.

#decision [[factory-duckdb]]
Old `devenv/duckdb` only installed an overridable CLI when enabled, ran a version smoke on `enterTest`, and added no tasks or database. Factory's opt-in `nix/duckdb/default.nix` exposes the overridable `quantile.duckdb.package` without installing it or creating a database on import. Its single colocated consumer test runs the version smoke, an in-memory SQL query, a real package override and checks for no project files. The old `enable` gate is replaced by explicit consumer installation; `enterTest` is not registered implicitly. No inline tool policy or CLI settings existed to move into an `etc/` asset.

#decision [[factory-gcp]]
Old `devenv/gcp` opt-in installed an overridable `pkgs.google-cloud-sdk` and ran credential-free `gcloud --version` on enterTest with telemetry and component-update checks disabled. It had no tasks, cloud operations, project/ADC setup, or tool-policy/config data to migrate into `etc/`; Google's native SDK config is a caller-owned writable authentication/project profile, not an appropriate static Factory template for two smoke-test flags. Factory's existing `quantile.gcp.gcloud.package` already exposes the same overridable package without implicit installation; Factory explicitly installs it in its own Devenv shell. Its colocated consumer test now exercises the real pinned `gcloud --version` in an isolated HOME/CLOUDSDK_CONFIG with the old noninteractive/telemetry/update guards and verifies no ADC file is created; it retains the actual package-override smoke. No new module wrapper, static asset, hooks, or automatic cloud actions are warranted.

#decision [[factory-git]] [[factory-native-config]]
Old `devenv/git` registered multiple Devenv/Prek hooks and a safety-critical installer that composed pre-push checks, legacy hooks and LFS. Factory instead offers opt-in Git/LFS/Prek/Commitizen/Gitleaks tool packages, `etc/git/.pre-commit-config.yaml` and `.cz.toml` native templates, a read-only Prek `check.package`, and `prePush.package` that buffers the exact ref stream and runs checks, an explicitly selected legacy hook, then Git LFS. The native template retains the 1200 KB LFS-exempt size limit, case/merge/symlink checks, full-SHA GitHub permalink check (excluding `.gitignore`), Conventional Commits and full-history plus working-tree redacted Gitleaks scans. The shallow-repository guard stays in the Gitleaks executable. Hook registration, Git LFS filter setup, and explicit fix commands belong to each consuming repository; importing the module never installs hooks or runs checks/uploads. Git LFS `track` can create an upload-first pre-push hook even after `install --local --skip-repo`, so downstreams must explicitly wire the checked entry point over it. The consumer test exercises actual checks, commit-message enforcement, no implicit hook installation, rejection before legacy/upload, exact ref replay, and a real local LFS upload. The old Devenv hook registry and migration/locking installer are deliberately not ported as a central Factory registry. `config.quantile.git.hooks.withPrePush [ "markdown" "keep-sorted" ]` optionally builds a patched copy of the one native Prek template for a consumer to link as `.pre-commit-config.yaml`; it moves only requested manual checks to pre-push, preserves comments/YAML anchors, accepts already-enabled checks, and rejects unknown/non-check/fix IDs. It never installs `.git/hooks/pre-push`, disables existing baseline checks or turns manual fixes into push-time mutations. The consumer owns local tool installation, Kubeconform schema args and actual Git pre-push wiring. After all old modules are reviewed, audit the consuming `devenv.nix` wiring against former registry behavior (see [[devm-nix-final-audit]]).

#decision [[factory-json]] [[factory-native-config]]
Old `devenv/json` installed overridable jq and configured pre-push `check-json` (strict syntax, duplicate keys, extra trailing data) with default exclusion of JSONC `tsconfig.json`; native hook exclusions could be appended or replaced. The package-only Factory JSON module retains `jq.package` and exposes overridable `prek.package` plus a read-only `check.package` that runs exactly the `check-json` hook, fail-closed from the *consumer's one* `.pre-commit-config.yaml` (`GIT_HOOKS_CONFIG` override). The optional shared native Prek template `etc/git/.pre-commit-config.yaml` now includes `check-json` with stage `pre-push`, type `json` and the old `tsconfig\\.json$` exclusion; consumers can copy/patch it or configure the hook in their own single file. Do not create a per-module full Prek config or merge registry: Prek reads one project config, and the downstream owns hook installation/order and native exclusions. A consumer test exercises jq, actual strict JSON/duplicate/extra-data failures without mutation, JSONC exclusion and native override, and no hook installation. The check package does not run unrelated hooks; importing the module does not install or enable any.

#decision [[factory-k8s]] [[factory-native-config]]
July `devenv/k8s.nix` enabled a single bundle (safe kubectl wrapper, kubeconform, k9s, Helm, Kustomize, Minikube and Tilt), a default-on drifting remote `p/kubernetes` Semgrep suite, a conditional pre-push YAML hook when `k8s/` exists with `-summary -strict -ignore-missing-schemas`, and `**/charts/` Gitignore. The old hook neither selected only Kubernetes manifests nor failed on unknown schemas. Factory instead keeps the tested `nix/kubectl` Krew-safe wrapper and `nix/kubeconform` strict+summary read-only check with explicit caller-owned local schema templates and no remote fallback; the native Prek template at `etc/prek/.pre-commit-config.yaml` is manual until the consumer supplies schemas and opts in. Five separately overridable, opt-in CLI modules (`nix/k9s`, `nix/helm`, `nix/kustomize`, `nix/minikube`, `nix/tilt`) now smoke-test real pinned versions without touching clusters. Three original, locally tested Kubernetes Semgrep rules at `etc/semgrep/rules/k8s/` cover privileged containers, host namespaces and the Docker host socket; they are selected static checks, not a verbatim/complete port of the remote suite. Their synthetic vulnerable YAML fixtures are explicitly excluded from Factory's native `etc/trivy/trivy.yaml` scan; real manifests are not excluded. The old `**/charts/` Gitignore pattern is deliberately not ported: downstream repositories decide which charts are generated and own their native `.gitignore`. Do not add optional Gitignore snippet assets to `etc/` for this review. None of these modules installs a tool/hook or touches clusters on import. [[devm-nix-final-audit]] must check downstream tool installation, schema provision, hook selection/order and local rule wiring.

#decision [[factory-oci]] [[factory-native-config]]
July `devenv/oci.nix` combined three generic CLIs (`docker-client`, `skopeo`, `container-structure-test`) with a default-on remote `p/docker` Semgrep suite when enabled, a GitLab-specific `nix2container` dev-shell-closure image, and Devenv `oci:build`/`oci:push` tasks. The user does not need the old CI cache-image path because current workflows use Namespace cache volumes and Cachix. Factory instead exports three independent overridable CLI modules at `nix/docker-client`, `nix/skopeo`, and `nix/container-structure-test`, with local package-override and credential-/daemon-free version tests (including Docker Buildx). The existing `nix2container` flake input remains available for consumer-owned image definitions; no CI image, closure recipe, registry/tag/secrets task, or unpinned patched Skopeo `nix:` transport is ported. Stock Skopeo does **not** implement that `nix:` transport; any future nix2container publication must deliberately select a compatible pinned transport and safe registry policy. One original, locally tested Dockerfile Semgrep rule under `etc/semgrep/rules/dockerfile/` detects `FROM ...:latest` (including multistage and platform-qualified forms); it is not full `p/docker` parity and does not activate remote rules. The synthetic Dockerfile test includes a non-root USER so Factory's Trivy scan needs no fixture exception. July supplied no generic native container test config or Dockerfile to move into `etc/`; each consumer owns its image definition, Dockerfile/ignore and credentials. Importing the modules does not build, push, contact a daemon/registry or install hooks. Full local `nix flake check path:.`, `check:all` and 101/101 Vitest passed; no commit or publication. [[devenv-nix-final-audit]] must verify any downstream that needs these CLIs selects them explicitly.

#decision [[factory-keep-sorted]] [[factory-native-config]]
Old `devenv/keep-sorted` installed overridable keep-sorted, registered read-only pre-push `--mode lint` on tracked text with configurable shared exclusions, and contributed an explicit fix to the central fix-task registry. Its fix used a separate generated Prek config invoking `--mode fix`, reran once after Prek's rewrite-as-failure exit 1, and only allowed subsequent fixes after a clean pass; malformed blocks failed without fixing. Factory exposes opt-in `nix/keep-sorted/default.nix` check/fix packages plus the CLI and overridable Prek. The existing *single* optional native `etc/git/.pre-commit-config.yaml` has `keep-sorted` lint initially at manual stage (downstreams explicitly opt in to pre-push) and `keep-sorted-fix` at manual stage; a YAML anchor shares their exclusion regex, which consumers change there. Both wrappers fail closed if the required hook/stage is missing (Prek otherwise reports skipped hooks as success); check never fixes, while explicit fix retries exactly once after exit 1 and only returns success after a clean pass. Sorting options stay in per-file `keep-sorted` annotations, not Nix settings or a second config file. The synthetic consumer verifies actual read-only errors, clean scoped fixes after a rewrite, malformed-block failure, excluded/binary/untracked/symlink boundaries and native exclusion override. Import does not install hooks or register fixes; [[devm-nix-final-audit]] must verify downstream pre-push activation, shared exclusions and explicit fix order.

#decision [[factory-logs]] [[factory-native-config]]
Old `devenv/logs` was an opt-in, overridable `pkgs.lnav` installation with only a credential-free `lnav -V` enterTest. It had no log paths, static formats/preferences, tasks, hooks, reading at startup, or inline policy to migrate to `etc/`. Factory's `nix/logs/default.nix` exposes `quantile.logs.lnav.package` without installing/running it; consuming repositories opt into their own shell and decide which logs to open. Its one colocated consumer test runs the pinned `lnav -V` in an isolated HOME without opening a log. `lnav -V` itself creates per-user writable `.lnav` state, which is not a static Factory asset. No wrapper, central registry or tautological Nix-only tests. The final [[devm-nix-final-audit]] should confirm any downstream that previously enabled this tool now explicitly installs it.

#decision [[factory-postgres]] [[factory-native-config]]
July `devenv/postgres.nix` was an opt-in bundle that only installed `pkgs.nssTools` and `pkgs.postgresql`; unlike an outdated note, it had **no** enterTest/version smoke, service, schema, config, hooks or tasks. Factory already splits these into independent overridable `nix/nss/default.nix` (`quantile.nss.package`, tools output) and `nix/postgresql/default.nix` (`quantile.postgresql.package`) modules, without implicitly installing either. Its focused consumer tests run PostgreSQL client/server version commands and `certutil -H` in isolation, confirming no database or certificate store is created; both passed in the July review (2/2). Any `postgresql.conf`, service, cluster and NSS database remain consumer-owned, so no static `etc/postgres` template or new source is warranted. [[devenv-nix-final-audit]] should verify any downstream that previously enabled the bundle explicitly selects whichever packages it needs.

#decision [[factory-prettier]] [[factory-native-config]] [[factory-format-tooling]]
July `devenv/prettier.nix` enabled Prettier by default, installed `pkgs.prettier`, generated only an ignore file with `**/node_modules/**`, `**/build/**`, `**/dist/**`, registered a pre-push `--check --ignore-unknown` hook over JSON/YAML/Markdown plus JS/TS if TypeScript was enabled, and a broad `prettier --write .` fix. It did **not** specify `printWidth`, `proseWrap`, Git-scoped fix selection, negation parsing or symlink policy; the old checkout had no `.prettierrc`/`.prettierignore` file. Factory's `etc/prettier/.prettierignore` retains all three old ignores as native policy; its optional `etc/prettier/.prettierrc.json` 80-column/always-wrap defaults are Factory choices, not a verbatim July setting. `nix/prettier/default.nix` exposes optional overridable Nix Prettier and separate read-only Git-selected check/explicit tracked-only fix packages: both require caller-owned pathspecs, native config and ignore, plus an explicit `PRETTIER_BIN` selecting a project-pinned or Nix CLI (never implicit npx). They honor native Gitignore negations, skip symlinks, and fail on explicitly selected unsupported files rather than silently dropping them. The optional shared Prek template declares both hooks manual; Factory itself uses Biome for JS/TS and Markdownlint for Markdown and does not auto-install or invoke Prettier. The focused consumer test proves native ignore/config overrides, check nonmutation, targeted fix and no untracked/symlink writes (passed 1/1); no source changes were needed in this review. [[devenv-nix-final-audit]] must determine whether downstream still needs Prettier, which CLI/config it chooses, and explicitly wire any check/fix without overlapping existing formatters.

#decision [[factory-protobuf]] [[factory-native-config]]
July `devenv/protobuf.nix` opt-in installed exactly four packages (`pkgs.buf`, `pkgs.protobuf`, `pkgs.protoc-gen-go`, `pkgs.protoc-gen-connect-go`) and emitted a generated Gitignore section for `v3/` Buf cache and `gen/` output. It had no overridable package options, mergeable generator list, version smokes, config, hooks, schema, descriptor or code generation. Factory already exposes separate overridable `nix/buf` and `nix/protoc` tool modules; the latter adds the two Go generator packages through a mergeable `quantile.protoc.generators` list (Factory behavior, not an old feature). No installation/generation occurs on import; consumers explicitly select tools, own `buf.yaml`/`buf.gen.yaml` and `.proto` sources, and decide which generated paths to ignore in their own `.gitignore`. Do not create optional Gitignore snippet assets for `v3/` or `gen/` or globally ignore source trees with those names. The colocated tests run all four real CLIs, demonstrate explicit descriptor compilation without changing input, and verify generator append/force semantics; focused 3/3 passed. No reusable inline Buf/Protobuf configuration warranted a new `etc/` asset. [[devenv-nix-final-audit]] must verify downstream tool selection and any explicit generation; never add automatic codegen merely by importing modules.

#decision [[factory-python]] [[factory-native-config]] [[devenv-nix-final-audit]]
July `devenv/python.nix` enabled Devenv's Python/uv integration when selected (`python.version` optional), installed Ruff and mypy, generated Ruff TOML (`line-length=120`, lint E/F/I/UP/B/SIM/S) and mypy INI (`warn_return_any`, `warn_unused_configs`, `disallow_untyped_defs=False`, `ignore_missing_imports=True`, and a static `python_version` of configured version or 3.12), added a four-space `[*.py]` EditorConfig section, a GitHub Python Gitignore template, the remote `p/python` Semgrep suite, three Python pre-push hooks and a broad Ruff `--fix .` then `format .` task. Factory already stores the same static tool settings in `etc/ruff/ruff.toml` and `etc/mypy/mypy.ini` (without a stale static Python version); `nix/ruff` and `nix/mypy` pass target versions derived from the selected `nix/python` interpreter at runtime with explicit env overrides. `nix/uv` remains separately opt-in; Python dependency resolution, `pyproject.toml`, the lockfile and virtualenv are consumer-owned. Native `etc/editorconfig/.editorconfig` includes four-space Python style. Read-only lint/format/type packages select Git-scoped `.py`/`.pyi` including nonignored untracked source, while the explicit Ruff fix touches only tracked regular `.py` files; mypy checks files individually with isolated cache to avoid duplicate names. Optional native Prek hooks start manual. Do not restore the remote drifting `p/python` suite or copy the upstream generated Gitignore; consumers choose reviewed local static rules and ignore paths. Ruff's S lints already include security checks; no additional Python Semgrep rule was warranted by this module alone. Focused Python/Ruff/mypy/uv tests passed 4/4, with no source changes in the July review. [[devenv-nix-final-audit]] must verify downstream interpreter/uv activation, native config placement, check/fix ordering and dependency installation; module imports alone do not execute them.

#decision [[factory-prek-hook-ids]] [[factory-native-config]]
The single optional Prek template uses plain tool-oriented IDs without a `quantile-` prefix: `check-vcs-permalinks`, `gitleaks`, `check-json`, `kubeconform`, `keep-sorted`, `keep-sorted-fix`, and `markdown`. Generic third-party hook IDs (`check-added-large-files`, `commitizen`, etc.) stay unchanged. IDs are selectors, not executable names: `gitleaks` calls `check-gitleaks`, which preserves both scans and avoids shadowing the Gitleaks CLI. `check-vcs-permalinks` calls `check-github-permalinks` because the stock `check-vcs-permalinks` binary does not cover this GitHub blob/tree policy. Keep selectors, tests and downstream hook wiring in sync; no added registry or implicit hook installation.

#decision [[factory-markdown]] [[factory-native-config]]
July `devenv/markdown.nix` installed `pkgs.markdownlint-cli2`, specified hook rule settings in mergeable Nix attrs (MD003 atx, MD013 120 with table/code-block exceptions, MD024 siblings_only, and disabled MD029/MD033/MD040/MD041/MD060), selected Markdown via its pre-push hook, and added a two-space Markdown EditorConfig section plus a broad Semgrep Markdown exclusion. Factory's native `etc/markdownlint-cli2/.markdownlint-cli2.jsonc` carries the seven other rule choices; MD013 is intentionally disabled by a later explicit shared-policy decision ([[factory-downstream-github]]), not accidentally omitted. Stricter consumers may supply native overrides. `etc/editorconfig/.editorconfig` includes the two-space section; no broad Semgrep exclusion is needed for Factory's selected local rules. `nix/markdownlint-cli2/default.nix` exposes an overridable CLI, template path and opt-in read-only `check.package`: it requires consumer-native config (`MARKDOWNLINT_CONFIG_FILE` override), selects scoped Git Markdown including nonignored untracked files, skips symlinks and passes literal names with CLI globs disabled. The single optional `etc/prek/.pre-commit-config.yaml` declares `markdown` manual with `pass_filenames: false` and `always_run: true`; downstreams explicitly activate/order it, and Factory's `devenv.nix` links config and runs a scoped Markdown check in `check:all`. No implicit install, hook, fix or generated config. The focused consumer test proves real MD024 failures, nonmutation, literal/glob-character paths, native MD013 override and no hook installation; it passed in this review without source changes. [[devenv-nix-final-audit]] must verify downstream config placement and activation.

#decision [[factory-opa]] [[factory-native-config]] [[devenv-nix-final-audit]]
July `devenv/opa.nix` was **only** an opt-in package list for Conftest and OPA with `conftest --version` and `opa version` enterTest smokes. Its comment explicitly deferred a Terraform OPA test gate and policy corpus; the file had no suite registry, policy selection, hooks, static rule config or data files. Factory already offers independent overridable `nix/conftest` and `nix/opa` packages with opt-in read-only `check-opa` and `test-opa` executables; these checks are Factory capabilities, not features ported from July. Consumers explicitly choose `--policy`, `--namespace`, optional exact `--policy-file` and `--data`, and for Conftest Git workload pathspecs after `--`; no universal Rego policy warrants an `etc/opa` asset. The wrappers fail on empty work/test selection and keep adjacent workloads from becoming implicit policy data. The optional native Prek template exposes both as manual hooks; Factory's own `devenv.nix` runs three explicit Conftest checks over Terraform policies, not an automatic OPA unit-test gate. Focused OPA/Conftest tests passed (2/2), with no source changes or backup edits. [[devenv-nix-final-audit]] should verify each downstream's actual policy/data selection and check/test activation; packages alone are not execution.

#decision [[factory-nix-module]] [[factory-native-config]] [[factory-devenv-cli]]
July `devenv/nix.nix` enabled by default, installed Nixfmt, Deadnix and Statix, version-smoked the first two, registered three pre-push checks and a tracked-only `git ls-files -z '*.nix'` Nixfmt fix. It added `result` and `result-*` to Semgrep exclusions. It had no native tool-rule configuration and contained **no** direct-pin checker, input-update tasks or lockfile automation; do not attribute other July modules' recipes to this file. Factory's `nix/nix` exposes only an overridable Nix CLI; separate `nix/nixfmt`, `nix/deadnix`, and `nix/statix` expose overridable tools and read-only Git-selected check executables, plus an explicit tracked-only Nixfmt fix. The single optional `etc/prek/.pre-commit-config.yaml` offers these as manual hooks; Factory's own `devenv.nix` calls checks and fix explicitly. Native `etc/semgrep/.semgrepignore` now preserves the July `result`/`result-*` exclusions independent of a consumer's Gitignore, with a synthetic non-Git consumer test; do not add optional Gitignore snippet assets. No `etc/nix` tool config is warranted. Focused Nix/Semgrep tests (5/5), flake check and `check:all` passed. The final [[devenv-nix-final-audit]] must verify downstream installation, hook activation and explicit fix/check execution.

#decision [[factory-go]] [[factory-native-config]]
July `devenv/go` installed a Go toolchain, optional language-server/debugging/generation tools, native and registry-based lint/format policies, and pre-push/fix hooks. Factory's `nix/go/default.nix` exposes only the overridable Go compiler; `nix/golangci-lint/default.nix` owns a separate read-only lint check and explicit tracked-source lint fix, reading native `etc/golangci-lint/.golangci.yml`. It copies source to a temporary tree, disables ambient toolchain/workspace switching, checks module metadata for changes and copies back only selected tracked Go files on a successful fix. `nix/gofumpt/` and `nix/goimports/` own independent Git-selected read-only format checks and tracked-only fixes. Goimports uses the selected `nix/gotools/` package. Six opt-in package modules expose Delve, Mockery, gopls, gotools, sqlc and templ. Factory's local `etc/semgrep/rules/go/` rule checks `fmt.Errorf` leading error-context wording, with rule-local generated-source exclusions and a tested fixture; no remote `p/golang` rules are imported. No module import installs tools, runs generation, adds hooks, or runs fixes. Consumers own Go version/overlay/hardening, shell and editor installation, check/fix orchestration and any explicit `go mod tidy` or `go generate` tasks. Never include dependency or code generation in a generic Go fix: those commands can change metadata or arbitrary source.

#decision [[factory-github]] [[factory-native-config]]
Old `devenv/github` combined Actionlint/ShellCheck with a central Devenv task command registry for check/build/plan/apply, an update-target matrix and mutation guard, and a Git-hook registration. Factory deliberately keeps task orchestration in each consuming `devenv.nix`/CI, existing guarded production Plan/Apply executables and Dependabot instead of bringing back those central registries. The existing `nix/github/default.nix` already exposed opt-in GitHub/Actionlint tools and native `etc/github/actionlint.yaml` plus `etc/github/dependabot.yml` templates. Its standalone checker now retains the old meaningful behavior: from the Git root, select tracked and untracked nonignored `.github/workflows/*.yaml`/`*.yml`, invoke pinned ShellCheck explicitly, disable optional Pyflakes, and let Actionlint discover consumer-native configuration (or use `ACTIONLINT_CONFIG_FILE`). Native Actionlint `paths.<glob>.ignore` can replace old Nix `ignorePatterns`; runner labels remain in the consumer file. Its existing synthetic consumer test now also rejects an actual embedded-shell SC2086 finding without source mutation. No hooks or tasks are registered by module import. The separate final consuming `devenv.nix` audit must verify check/hook and task wiring; presence of an Actionlint package alone is not execution.

#decision [[factory-editorconfig]]
Old `devenv/editorconfig` mixed read-only checker hooks, Nix-generated checker exclusions and a Nix-generated, manual-only Prek EOF fixer. Factory retains the consumer-owned native `etc/editorconfig/.editorconfig` and offers `etc/editorconfig/.editorconfig-checker.json` for native regex exclusions (including its tracked `devenv.lock`, which need not end in a newline). The opt-in `nix/editorconfig/default.nix` exposes native config paths and separate read-only check / explicit EOF-fix packages. They select tracked regular text files from the Git root, skip binaries, symlinks and untracked files, and use the same native exclusion list; a missing `.editorconfig` fails checks. The fixer invokes pinned `end-of-file-fixer` only when explicitly run, repeats after its rewrite exit 1 and propagates other failures, so a successful rewrite does not block later consumer fixes. Importing the module installs neither tools nor hooks/tasks; orchestration stays consumer-owned. The focused test covers actual checker diagnostics, no mutation on check, scoped fixes, missing native config and a failing fixer. No generated Prek config or duplicate Nix exclusion options.

Semgrep's native policy is `etc/semgrep/rules/` and its ignore template is `etc/semgrep/.semgrepignore`, linked at Factory's root and excluded from Git there. The Devenv `.semgrep` directory link points at `rules/` only, so edits to its sibling ignore template do not change the linked directory's store path. `nix/semgrep/default.nix` exposes separate rule-test and source-scan executables, both invoked explicitly by Factory's `devenv.nix`. Rule tests fail on empty selection; source scans fail on findings. Both disable metrics, use native rules/ignores, and avoid generated `--exclude` arguments or a suite registry. Pinned Devenv's `files` implementation has an independent directory-symlink update bug (`ln -sf` follows an existing link to a directory). Factory explicitly imports `devenvModules.files` from `nix/devenv/default.nix`: a generic task after `devenv:files:cleanup` and before `devenv:files` removes only changed directory symlinks backed by the Nix store and recorded in Devenv's managed-files state. Devenv then recreates them; correct links and copy/seed entries are untouched. New directory declarations are covered automatically, without patching/forking upstream or enumerating leaf files. The link briefly disappears between tasks; this is not cross-process locking. Use Nix path interpolation for the desired `file` target, not `toString`, so it matches Devenv's materialized store path. The user rejected an upstream patch and a checked-in relative link. Per-file Semgrep fixture symlinks were experimentally rejected by Semgrep with misleading success status; retain the directory link with regular fixture files beneath it. Evidence: https://github.com/higherorderfunctor/nix-agentic-tools/issues/2229 and the historical merged guard in https://github.com/higherorderfunctor/nix-agentic-tools/pull/2223. Full consumer coverage is colocated at `nix/devenv/default.test.ts`. Other Nix modules were reviewed: Clang/Biome/Actionlint/EditorConfig/Pi/QMD/SecretSpec already use native assets, while Terraform's remaining flags enforce execution and saved-plan safety, not tool policy. Package-only DuckDB/GCP/Logs need no asset; JSON's hook policy is in the optional shared Prek template.

<!-- 2026-10-18 15:12:19 [01a14275] -->
#decision #todo [[factory-old-devenv]] [[devm-nix-final-audit]]
After reviewing and selectively porting every old Devenv module, do a separate end-to-end audit of the consuming `devenv.nix` against the old registry-driven behavior. Inventory every previously registered hook/tool/task (especially Git pre-push, commit-msg, LFS order, secret scans and explicit fixes), map it to explicit downstream `devenv.nix`/native configuration or document an intentional omission, and verify actual execution rather than merely finding packages/options. Do not silently change the old checkout's unrelated dirty work or enable hooks on Factory module import; arrange any `devenv.nix` edits as separately reviewed consumer integration.

<!-- 2026-10-18 16:26:50 [01a14275] -->
#preference #decision [[factory-old-devenv]] [[factory-batched-ci]]
During the remaining old Devenv module-by-module reviews, do not merge each module to main or trigger GitHub workflows after each module. Keep and validate changes locally; batch publication and branch CI after a sensible group or when the user asks. Preserve the protected-main and exact-head Check gate for an eventual merge, and never run a manual Test or production Plan/Apply without separate authorization. Review and commit sanitized project memory alongside the eventual implementation commits rather than making separate per-module outcome-note/Check cycles.

<!-- 2026-10-18 16:54:26 [01a14275] -->
#correction #decision [[devenv-nix-final-audit]] [[factory-old-devenv]]
The final integration audit concerns the consuming file `devenv.nix` (in the relevant downstream checkout), **not** a repository/product named “DevM.Nix”. Earlier `[[devm-nix-final-audit]]` references meant this `devenv.nix` audit. Compare former old Devenv registries with explicit consumer file/native configuration and actual execution after the remaining modules are reviewed.

<!-- 2026-10-18 16:58:53 [01a14275] -->
#correction #decision [[factory-nix-module]] [[factory-devenv-cli]]
For the old `devenv/nix` review, do **not** conflate `direnv` with `devenv-cli`: `direnv` is a user-installed host prerequisite and should not be included in the new Nix module's package list. Factory builds the pinned `devenv-cli` via its flake output (`.#devenv-cli`), and `.envrc` explicitly selects that CLI and loads its direnv integration. The old input-update task registry and direct dual-pin checker are obsolete for Factory's current flake-follow/Dependabot model; retain existing `check-devenv-locks` and review only useful Nixfmt/Deadnix/Statix check/explicit-fix behavior. Audit the consuming `devenv.nix` later for explicit wiring.

<!-- 2026-10-18 17:05:55 [01a14275] -->
#verification [[factory-batched-ci]] [[factory-old-devenv]] [[factory-nix-module]]
The batched keep-sorted, logs, Markdown, optional Prek selection, and Nix module ports (local commits `4cda4bf` through `0b5d7be`) passed exact-head branch Check 39174923712 on `0b5d7be4892ffcb657a571cb1a6b176245555c49`; protected main and the local main checkout advanced by ordinary fast-forward to that SHA. No manual main Test, production Plan/Apply, PR bypass, or force push. The remaining old Devenv module reviews and consuming `devenv.nix` integration audit remain open.

<!-- 2026-10-18 18:57:43 [01a14275] -->
#correction #decision [[factory-tool-first]] [[factory-json]] [[factory-go]]
In the proposed tool-first Factory Nix refactor, **do not invent module identities from command/capability names**: `check-json` and `go-check` are checks, not standalone tools. Prek owns its `check-json` hook; the actual Go tools include Go, gofumpt, goimports and golangci-lint. Keep cross-tool safety orchestration clearly labeled and consumer-owned (or isolated as an explicitly named operation), rather than pretending it is a tool. Review boundaries before mechanical module renames.

<!-- 2026-10-18 19:25:40 [01a14275] -->
#decision #implementation [[factory-tool-first]] [[factory-config-layout]] [[factory-native-config]]
Factory's coordinated tool-first refactor replaces the old domain bundles with real-tool module roots in `nix/` and tool-owned assets in `etc/`: e.g. `jq` vs `prek.checkJson`, `go`/`gofumpt`/`goimports`/`golangci-lint`, `python`/`ruff`/`mypy`/`uv`, `clang-format`/`clang-tidy`, `nix`/`nixfmt`/`deadnix`/`statix`, `opa`/`conftest`, `protoc`/`buf`, `kubectl`/`kubeconform`, and `opentofu`/`trivy`. EditorConfig and editorconfig-checker stay together by user choice; Git and Git LFS retain guarded pre-push sequencing. Prek owns the shared hook template; Dependabot policy remains a native service asset at `etc/dependabot/`, with a small Nix selector that emits only the consumer's chosen update ecosystems rather than a fictitious CLI package. No `nix/lib/` directory. The shared Rego policy-selection safety snippet is colocated at `nix/opa/policy.nix`. Go, gofumpt, goimports and golangci-lint expose separate tool-owned operations; their consuming repository chooses the order. `nixModules.default` imports canonical tool paths (rather than prematurely applying imports as functions), allowing individually imported tools with dependencies to deduplicate. Factory's consuming `devenv.nix` explicitly selects renamed tools and native assets. These option names are intentionally breaking for external consumers; downstream adoption is separate from the later old Devenv review/integration audit. README unchanged; no production deployment was authorized.

<!-- 2026-10-18 19:34:06 [01a14275] -->
#verification #decision [[factory-tool-first]] [[factory-native-config]]
Independent post-refactor inventory of `nix/default.nix`, tool modules and `etc/` found no remaining domain-named bundle to split. EditorConfig Checker and its EOF fixer intentionally share EditorConfig's file/exclusion contract; Git/LFS retains guarded pre-push order; Prek's tool package supplies its hook template. `GIT_PRE_PUSH_LEGACY` is still a supported optional chained-hook input, not a reason to bring back the earlier hook registry. Keep comments and option descriptions about current behavior rather than migration rationale. The user explicitly rejects references to the July backup, old implementations or legacy history in source comments/descriptions; preserve historical context only in memory logs. Do not rename real upstream APIs, policy identifiers or operational backup concepts merely because they contain those words. The ten remaining old-module reviews and the separate consuming `devenv.nix` execution audit remain open.

<!-- 2026-10-18 19:43:12 [01a14275] -->
#verification [[factory-tool-first]] [[factory-batched-ci]]
Tool-first ports and the independent module/description audit landed on main at 9b4671316cd425daec21ca1d64b915a8bb2d19b0 after exact-head Check 39186137966. Manual main Test 39186365743 passed. The ten remaining old-module reviews, downstream option migration and final consuming `devenv.nix` execution audit are not finished. No production Plan/Apply was run for this batch.

<!-- 2026-10-18 19:59:38 [01a14275] -->
#decision #verification [[factory-semgrep]] [[factory-native-config]] [[factory-old-devenv]]
July `devenv/semgrep.nix` was default-on `pkgs.semgrep` with a pre-push check using remote `p/security-audit`, `p/owasp-top-ten`, and `p/secrets` plus optional domain-supplied `p/docker`, `p/golang`, `p/kubernetes`, `p/python`, `p/terraform`, `p/javascript`, and `p/typescript`; it also excluded `*.lock`, `*.log`, `*.tmp` and version-smoked the CLI. It had no pinned rules, local fixtures or tests. Factory keeps `nix/semgrep/default.nix` with separate opt-in read-only rule-test and source-scan executables, runtime `SEMGREP_RULES_DIR`/`SEMGREP_TESTS_DIR` selectors and manual Prek hooks. The test runner rejects empty selection even though Semgrep exits 0 on no unit tests; Factory's consumer explicitly runs tests then scans local rules. Native `etc/semgrep/.semgrepignore` now preserves the old transient-file exclusions plus previously reviewed Nix result outputs, rather than constructing shell-quoted `--exclude` arguments. The user authorized upstream Git pinning with no dropped pack rules, keeping cache work out of scope. The unpublished review branch now pins non-flake `semgrep-rules` at 17e31e11ebac99fb7dfe1cd288f7a32151b6f3f9 in both lockfiles. Native inventory `etc/semgrep/packs.json` maps each pack's full rule IDs to upstream paths; the small module-local builder selects those exact rules, keeps their registry IDs, and fails on missing files or ambiguous/missing IDs. `quantile.semgrep.packs` exposes local configs; opt-in `check.configs` adds them beside caller-owned local rules. Factory explicitly selects all ten. Comparison against fresh registry responses proved identical non-metadata rule bodies for all 1,259 pack entries / 748 distinct rules: Docker 7, Go 42, JS 74, Kubernetes 11, OWASP 560, Python 151, secrets 52, security-audit 225, Terraform 63, TS 74. No whole-language-directory substitution or dropped checks. Pinned Semgrep validated all 748; two focused consumer tests passed (one added meaningful upstream-plus-local unsafe/safe scan), as did flake, TypeScript, formatting and inventory spelling checks. The user authorized resolving the five resulting findings. Both native and rendered Dependabot configs now specify seven-day cooldown for all four ecosystems. Current GitHub docs confirm support for all four and a default three-day cooldown when absent, correcting the earlier claim of no minimum release age. The GCP module now declares storage ADMIN_READ/DATA_READ/DATA_WRITE Cloud Audit Logs; its existing Conftest policy rejects missing log types or exemptions. Google recommends Cloud Audit Logs over bucket-log delivery for access auditing, so the bucket has a single documented nosemgrep exception for the bucket-logging-only rule; a probe confirmed another unlogged bucket is still detected. Full scanning then exposed three engine parsing errors in nested shell commands with unquoted .#devenv-cli; quoting that argument in Test/Plan/Apply fixes parsing without dropping rules or changing command behavior. Full local check:all and 13 focused Dependabot/GCP/workflow/infrastructure tests passed. Source remains unpublished; no remote state inspection, Plan/Apply, live audit configuration or workflow dispatch. Remaining module/consumer reviews are still pending. [[devenv-nix-final-audit]] must verify chosen downstream rules/config/ignore placement and actual scan/test execution.

#decision [[factory-storage-audit]]
`tf/modules/project/gcp/main.tf` owns `google_project_iam_audit_config.storage` for its state project and `storage.googleapis.com`, enabling ADMIN_READ, DATA_READ and DATA_WRITE without configured exemptions. The bucket depends on audit configuration. This is service-scoped authoritative IAM audit configuration, not a project IAM policy replacement; inspect existing service-specific audit settings and inherited exemptions in the separately authorized rollout. Logs use Cloud Logging rather than a second GCS logging bucket; normal Logging retention, routing and charges apply. No runtime live-audit claim follows from source validation. The source-level bucket-log-delivery exception is paired with `main.rego` enforcement and one focused negative regression test. Dependabot cooldown is seven days for version updates only; security updates are not delayed by that option.

#research #correction [[factory-semgrep-pinning]]
GitHub examples verified: `timfewi/tentaflake` at 126e4829ffcd72eab32852dd3962f6e8574e4f06 uses `fetchFromGitHub` with rules revision 40b8c63f75dc7c22c8a77482d73bfb864b146f7e and hash `sha256-VtPavzFGDmRzdG9wTFc+yp7TbI1gT1/IaF//K1m3OT0=`; `lucascherzer/deppops` at 322db77cdec240a0f626f6ad50ef3fe983534b7a locks a non-flake `semgrep-rules` input by revision and narHash; `AlexaDeWit/Ecluse` at ef91f5be53eb72b0e01354b69a53c75e6df608d5 uses commit-qualified raw rule/test URLs with fetchurl hashes. A private temporary Nix probe successfully verified tentaflake's exact upstream pin and ran the upstream PyYAML positive/negative fixture (1/1 passed) inside a normal network-isolated Nix derivation (`sandbox = true`), using Factory's pinned Semgrep 1.172.0. CACert must be supplied even offline because this CLI initializes its TLS stack. No Factory source/lock changes or publication. Registry `p/` labels are curated selections, not identical to whole language directories; reproducible coverage needs a reviewed file manifest and compatible pinned engine. Semgrep docs support local configs; upstream issue #3147 documents lack of npm-like pack install/lock, and old versioned-CDN PR #3973 is not implemented in current inspected resolver. Current upstream rules carry SRL; opengrep-rules is LGPL-2.1 plus Commons Clause, not a blanket permissive-license escape. The recommendation is pinned upstream rules with explicit selection and separately reviewed cache/redistribution handling, not default reinvention of upstream coverage.

<!-- 2026-10-18 20:20:37 [01a14275] -->
#decision #verification [[factory-shellcheck]] [[factory-shfmt]] [[factory-native-config]] [[factory-old-devenv]]
Re-read July `devenv/shell.nix` directly: default-on ShellCheck/shfmt installation and version smokes, quote-safe/unassigned-uppercase ShellCheck policy, four-space shell indentation, shfmt `-s -ci`, executable-shebang pre-push check, and ShellCheck excluding root `.envrc`. Its shfmt pre-push hook used `-w -l` and the fix command targeted `.`, so neither was read-only/tracked-only; the earlier memory description was incorrect. It had no task-body lint helper. Current independent `nix/shellcheck` and `nix/shfmt` retain all reusable tooling/settings under `etc/shellcheck/.shellcheckrc` and `etc/editorconfig/.editorconfig`, with intentional read-only checks and explicit tracked-regular-`.sh` fixes. Checks cover `.sh`, `.bash` and recognized extensionless shell shebangs while excluding `.envrc` and symlinks. Factory's additional task-body helper checks stdin statically using environment names rather than values. Native Prek entries expose shell checks, explicit formatting and executable-shebang checking without activation on import. Current consumer installs the CLIs and links config but does not run standalone shell checks/fixes or enable these manual hooks; keep that activation choice in the final consuming-devenv audit. Existing two focused consumer tests passed; no source changes/new tests were necessary for this review. Eight module reviews remain (`tf`, `toml`, `trivy`, `typescript`, `typos`, `vale`, `wasm`, `yaml`), plus the final consumer audit. No commit/publication or production action.

<!-- 2026-10-18 20:38:05 [01a14275] -->
#decision #verification [[factory-opentofu]] [[factory-tflint]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
User explicitly excluded terraform-docs on October 19: do not add its tooling, native configuration, generated documentation or checks. Review `tf.nix` for its other capabilities; missing terraform-docs policy is an intentional nonport, not outstanding work.

Direct review of July `devenv/tf.nix` confirmed OpenTofu/TFLint/version smokes, recommended Terraform rules plus the eight explicit native TFLint rules, recursive formatting/lint hooks, validate, remote p/terraform, and generated-file exclusions. It also contained GitLab credential/identity/backend derivation, local overrides, per-root init/plan/auto-approved apply, force state-push, destroy and scaffolding. It did not contain the previously claimed providerUpdater or Factory's nonempty/isolated-validation/tracked-only-fix implementations. Existing separate `nix/opentofu` and `nix/tflint` cover the reusable tools; `etc/tflint/.tflint.hcl` retains every native lint setting. Checks use explicit roots/native policy and isolated backend-free module data; fixes remain explicitly selected tracked regular files. Factory's consumer already wires these checks and fixes. Its pinned 63-rule Terraform pack retains the current registry selection. Added native Semgrep exclusions for `.terraform/`, `.terraform.lock.hcl`, `*.tfstate`, `*.tfstate.*`, and `*.tfplan`, with the existing consumer test extended to root/nested Terraform data directories without Gitignore. Deliberately keep `.tfvars` eligible for source/security scans rather than copy the blanket exclusion of input files. No Gitignore snippets, GitLab deployment helpers, force-push/destroy automation, scaffold, or terraform-docs port. Bash/curl/jq installed solely for those provisioners/helpers do not require reintroducing an umbrella toolchain; current module deployments use the existing guarded saved-plan workflows. Five focused OpenTofu/TFLint/Semgrep tests and full local check:all passed. Seven reviews remain (`toml`, `trivy`, `typescript`, `typos`, `vale`, `wasm`, `yaml`) plus final consuming-devenv audit. No README edit, commit, push, remote state operation or production workflow.

<!-- 2026-10-18 20:51:02 [01a14275] -->
#decision #verification [[factory-taplo]] [[factory-native-config]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct review of July `devenv/toml.nix` confirmed default-on Taplo installation/version smoke, four true formatting settings (`align_entries`, `array_trailing_comma`, `reorder_keys`, `trailing_newline`), a pre-push `taplo check` hook and Git-selected tracked-TOML formatting fix. It did not supply a separate format-diff check or schema/include/exclude defaults; those are current Factory capabilities, not facts about that source. Existing `nix/taplo` and native `etc/taplo/taplo.toml` retain all four settings. Read-only validation and format checks plus explicit tracked-regular-file fixes use caller-native config or `TAPLO_CONFIG_FILE`; the consumer already installs the CLI, links config and invokes both checks and explicit fix. Existing focused test passed, including syntax/format rejection, config override/exclusions, missing-schema failure and preservation of untracked/symlink targets. No source changes or new tests needed for this review. No commit/publication or production actions.

<!-- 2026-10-18 21:02:35 [01a14275] -->
#decision #verification [[factory-trivy]] [[factory-native-config]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct review of July `devenv/trivy.nix` found only default-on CLI installation and an empty-by-default configurable ignore-ID list serialized as a store file. It had no module-local scan, smoke or policy defaults. Its GitLab MR task consumed that file for `trivy filesystem`: HIGH/CRITICAL informational output followed by a CRITICAL blocking scan. The previous memory incorrectly attributed Factory's detailed policy to the source module. Current `nix/trivy` exposes overridable CLI/native configuration and a read-only source-root checker, using consumer `trivy.yaml` or `TRIVY_CONFIG_FILE`; native `.trivyignore` remains consumer-owned, with no default CVE IDs to port. `etc/trivy/trivy.yaml` explicitly enables vulnerability/misconfiguration/secret scanning, HIGH/CRITICAL failure, library packages, generated-output exclusions and four exact intentionally insecure Semgrep fixture exclusions (three Kubernetes, one Terraform). Existing consumer installs the CLI, links native policy and runs the scan in check:all. Existing focused offline misconfiguration test passed, proving fixture/build exclusions, real-source GCP finding, nonmutation and missing-input rejection. No source changes/new tests needed; no fresh vulnerability-DB/network test claimed. Five module reviews remain (`typescript`, `typos`, `vale`, `wasm`, `yaml`) plus final consumer audit: six outstanding items. No commit/publication or production actions.

<!-- 2026-10-18 21:14:20 [01a14275] -->
#decision #verification [[factory-typescript]] [[factory-biome]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct review of July `devenv/typescript.nix`: `quantile.ts.enable` was opt-in, supplying Node.js 22, Devenv JS/TS languages, two-space EditorConfig and Node Gitignore policy, p/javascript and p/typescript, and pre-push wrappers for nearest-tsconfig `tsc --noEmit` and nearest local ESLint. Its wrappers silently skipped missing compiler/linter executables, split ESLint filenames on whitespace, and did not guarantee that a selected file was included by tsconfig; previous memory attributed current Factory protections to the source incorrectly. Current independent `nix/nodejs` package, `nix/typescript` read-only project-local type checker and native EditorConfig cover reusable tool settings; the project-local compiler rejects missing tools/omitted files and redirects incremental build info to temporary storage. Both full pinned 74-rule JS and 74-rule TS packs are selected with other rules in Factory. User-chosen Biome native policy and locked package scripts replace ESLint; do not reintroduce ESLint or import-time package-manager/editor/hook actions. Current consumer installs Node/pnpm and runs native TypeScript/Biome checks with explicit fix; it does not invoke the optional generic TypeScript checker or manual Prek entry—reassess selection in final consumer audit without duplicating typecheck. No shared tsconfig asset: project tsconfig stays consumer-owned. Focused Node, TypeScript and Biome tests passed (3/3), no source changes/new tests for this review. Four module reviews remain (`typos`, `vale`, `wasm`, `yaml`) plus final consumer audit: five outstanding items. No commit/publication or production action.

<!-- 2026-10-18 21:29:07 [01a14275] -->
#decision #verification [[factory-typos]] [[factory-native-config]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct source review: July `devenv/typos.nix` enabled a pre-push Typos hook by default with generated configuration for UUID/long-hex regexes and four lockfile exclusions. It had no module-local CLI override, version smoke, Git pathspec wrapper or nonempty-root check; those are current Factory features. Factory now exposes optional `nix/typos/default.nix` with no task/hook installation on import; `etc/typos/typos.toml` holds native spelling policy and Factory's scoped AGENTS/negative-fixture/vendor exclusions. Checker requires consumer-native `typos.toml` or `TYPOS_CONFIG_FILE`, defaults to Git root or accepts Git pathspecs at runtime, checks regular tracked and nonignored untracked files (including hidden source), rejects invalid selection/config, and cannot fix source. `--force-exclude` is necessary for native file exclusions when passing explicit filenames; native `ignore-files=false` and `ignore-hidden=false` preserve Git's selection, including tracked hidden paths. Factory explicitly links the native template, installs the CLI and runs spelling in `check:all`; a manual Prek hook is available without automatic registration. One consumer test exercises a real spelling failure, native vocabulary/exclusion overrides, untracked/hidden/ignored and symlink boundaries, read-only operation and config/pathspec errors; full local pinned-shell `devenv tasks run test:all` passed. Three old modules remain (`vale`, `wasm`, `yaml`), then final consuming `devenv.nix` audit. No README edit, push/merge, manual Test or production Plan/Apply.

<!-- 2026-10-18 21:47:06 [01a14275] -->
#decision #verification [[factory-vale]] [[factory-native-config]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct source review: July `devenv/vale.nix` exposed an opt-in CLI and generated default INI using `.vale/styles`, `MinAlertLevel = suggestion`, `Packages = Google`, code/tt ignored scopes, script/style/pre/figure skipped scopes, and `BasedOnStyles = Vale, Google` for Markdown/TXT/RST/AsciiDoc. Its pre-push Markdown hook was silently disabled unless `.vale/styles` existed; there were no module-local version smoke, Git-selection wrapper, Quantile styles, 20 Google error overrides or native vocabulary files. The prior memory's claim that the Google/Quantile corpus was copied from this source was incorrect. Current native `etc/vale/.vale.ini` and `etc/vale/styles/` are Factory's chosen Google/Quantile prose policy, including explicit rule severities and optional consumer-edited accept/reject vocabulary. The native INI now retains the ignored/skipped scopes and Markdown/TXT/RST/AsciiDoc selection; Factory still invokes Vale only for explicitly selected Markdown. The consumer explicitly chooses Markdown and prose exclusions; other file types remain selectable by native policy if needed. Optional `nix/vale/default.nix` exposes template/style paths and a read-only checker; it requires consumer-native `.vale.ini` or `VALE_CONFIG_FILE`, selects Git source with runtime pathspecs, and installs no hooks or tasks. Do not canonicalize the config symlink before running Vale: it resolves relative `StylesPath` against the supplied config path, and Nix-store resolution breaks consumer styles. Vale ignores `.valeignore` for explicitly supplied filenames, so Factory keeps repository-specific prose exclusions as Git pathspecs in its explicit `devenv.nix` invocation (old AGENTS/fixtures plus Factory agent skills and append-only memory, not normal documentation). Factory links the native root config, installs the CLI, and runs Vale in `check:all`; a manual Prek entry stays opt-in. One consumer verifies real Google and custom writing findings, native rule override, real native reject vocabulary, untracked/ignored/symlink safety, invalid selection/config and no source mutation; complete local `devenv tasks run test:all` passed. At that historical review point two modules remained (`wasm`, `yaml`); the newer four-module review below supersedes that count. README untouched; no push/merge, manual Test or Plan/Apply.

<!-- 2026-10-18 21:58:39 [01a14275] -->
#decision #verification [[factory-wasm-tools]] [[factory-wabt]] [[factory-emscripten]] [[factory-yamllint]] [[factory-old-devenv]] [[devenv-nix-final-audit]]
Direct source review of July `devenv/wasm.nix` and `devenv/yaml.nix` reconfirmed their tool lists and actual defaults. Corrected an uncommitted over-bundled WASM draft at the user's request: `nix/wasm-tools/default.nix` owns read-only `.wasm` validation with wasm-tools; `nix/wabt/default.nix` owns read-only `.wat` parsing to `/dev/null`; `nix/emscripten/default.nix` exposes optional Emscripten and an explicit `with-emscripten-cache` command that requires `DEVENV_STATE` and sets `EM_CACHE=$DEVENV_STATE/emscripten-cache` only when invoked. WAT parsing discards compiler output, binary validation never runs a WASM module, and importing the modules creates no cache or installs packages or hooks. Binaryen and Wasmtime were plain package selections within the old opt-in WASM bundle, with no Factory-specific behavior, so consumers select ordinary `pkgs.binaryen` and `pkgs.wasmtime` directly rather than adding package-only registries. Native manual Prek entries expose separate WAT/WASM validation; Git pathspecs replace the old hook exclusion regexes. Focused consumers compile a valid WAT fixture for binary validation, reject malformed WAT/WASM without rewriting, skip external symlinks and ignored source, fail invalid pathspecs and verify opt-in state-scoped cache. No native WASM config exists for these validators; `/dev/null` is a nonmutation safeguard. Audited other checked-in tool modules for forgotten bundles: remaining cross-tool couplings are intentional (Git/LFS pre-push order, Prek's hook tools, EditorConfig checker/fixer policy, actionlint's optional ShellCheck integration), not old general-purpose bundles. Preserve those boundaries during the final consumer audit.
Old YAML generated settings moved to `etc/yamllint/.yamllint.yaml`: default inheritance; 120-column warning; two-space indentation; true/false/on/off truthiness; comments spacing; conventional output ignores. Native `document-start: disable` is Factory's consumer choice to lint existing source without mandatory `---`; July's module default was `present: true` and the directly inspected consuming `devenv.nix` had no explicit override. Consumers wanting document starts set `present: true` in native policy. Native file ignore covers vendored Google Vale styles, including when filenames are explicit. `nix/yamllint/default.nix` exposes only a read-only Git-selected checker requiring consumer-native config or `YAMLLINT_CONFIG_FILE`; optional manual Prek entry, no automatic hook/task. Factory explicitly links native config, installs CLI and runs it in `check:all`; WASM tools stay optional because Factory has no WASM source. A focused YAML consumer proves real duplicate-key rejection, native document-start override and Google-vendor exclusion, ignored/untracked/symlink boundaries, errors and source preservation. Local pinned-shell `devenv tasks run test:all` passed. All old modules are now reviewed; final consuming `devenv.nix` behavior audit remains. No README edit, push/merge, manual Test or production Plan/Apply.

#review #verification [[factory-four-module-review]] [[devenv-nix-final-audit]]
Rechecked July `typos.nix`, `vale.nix`, `wasm.nix`, and `yaml.nix` together against native assets and current tool-owned modules. Typos' two regexes and four lockfile exclusions match `etc/typos/typos.toml`; extra Factory exclusions remain scoped. Vale's source supplied Google/default styles and prose scope/filetype settings but no Quantile corpus or enforced Google overrides (earlier memory corrected above). Added `IgnoredScopes = code, tt`, `SkippedScopes = script, style, pre, figure`, and native Markdown/TXT/RST/AsciiDoc section to `etc/vale/.vale.ini`, retaining existing Google/Quantile and vocabulary choices; extended the existing consumer test to prove a `.txt` custom-rule failure. The consumer still deliberately selects Markdown only. WASM retains separate opt-in WABT/WASM-tools/Emscripten and direct plain `pkgs.binaryen`/`pkgs.wasmtime` selection if needed; no auto-cache or hooks. YAML's `document-start: disable` remains a deliberate consumer-specific divergence from the source's `present: true`, not incorrectly attributed to an old override. Six focused tests and full backend-free check:all passed after the change. Only the separate final consuming `devenv.nix` audit remains in the module-review sequence. No commits, pushes, or production workflows.
<!-- 2026-10-18 22:43:23 [01a14275] -->
#decision #verification [[factory-git-prepush]] [[factory-conventional-history]]
User rejected grandfathering and explicitly approved rewriting the nine unpublished pre-audit commit subjects to Conventional Commits. A controlled interactive rebase reworded only those subjects; all ten unpublished commits (including the already-committed audit) retained byte-identical Git tree IDs and order. A local read-only first-push simulation then passed the native push-time Commitizen checker for the complete unpublished range. No baseline exception or hook bypass was added, and no remote push had been made at this verification point. Publication still requires an exact-head Check before a protected-main merge; main Test was separately authorized.

<!-- 2026-10-18 22:47:50 [01a14275] -->
#bug #implementation [[factory-ci-check]] [[factory-gitleaks]]
The first Check after enabling native full-history Gitleaks failed on GitHub checkout's default shallow fetch, not on a leak. Factory's Check and manual Test workflows now set `fetch-depth: 0` on pinned actions/checkout; Test calls `test:all` and therefore also runs `check:all`. Keep `persist-credentials: false`, protected-main guards and production workflow separation. Require a successful Check for the fix-forward commit before merging; do not bypass the secret checker or weaken its unshallow preflight.

<!-- 2026-10-18 22:57:49 [01a14275] -->
#verification #decision [[factory-ci-check]] [[factory-main-test]] [[factory-old-devenv-retirement]]
After the shallow-checkout fix-forward, exact-head Check 39201405165 passed for Factory SHA 039b46e415a36faa4e8ef5af6dfbc2423632a24e. The authorized ordinary fast-forward from the checked feature worktree advanced remote and local main to those exact bytes; the worktree's installed pre-push hook passed and no production Plan/Apply ran. The separately authorized manual main Test 39201637207 passed on the same SHA, including `check:all`, tests and Cachix post-processing.
After Test, the user requested a complete copy before retiring the obsolete old Devenv repository. `cp -R` copied the entire `~/code/quantile-co` tree (including hidden Git data and dirty repositories) to private `~/code/quantile-co.bkp.20261018-225618`. A checksum-based, symlink-preserving rsync dry run reported zero content/path differences across the whole tree; the copied old Devenv repository had the same HEAD and all 189 staged/unstaged/untracked status entries as the source. Only `~/code/quantile-co/quantile-co/devenv` was then removed after checking there were no nested mounts; its verified backup remains at `~/code/quantile-co.bkp.20261018-225618/quantile-co/devenv`. Do not use the old Devenv runbook or restore old module imports from this archive; Factory remains the reusable flake and current source takes precedence.


<!-- 2026-10-18 23:17:15 [01a14275] -->
#decision #verification [[devenv-nix-final-audit]] [[factory-git-prepush]] [[factory-native-config]]
Factory's consumer explicitly links native Prek, Commitizen, Markdownlint and EditorConfig Checker policy and runs read-only Prek, Nixfmt, Deadnix, Statix, EditorConfig and scoped Markdownlint checks in `check:all`; explicit `fix:all` includes Nixfmt and EditorConfig EOF. Native memory history is excluded from the style check, README passed lint without edits, and local `test:all`/source-idempotent `fix:all` verified the audit. Importing tool modules never installs hooks or tasks; Factory's one-line `install:git:hooks` task calls the Git-owned executable explicitly. Commitizen is selected by native Prek policy at pre-push, never at commit time; Git runs Prek and any optional legacy hook before Git LFS upload.
The user corrected the initial worktree-only hook design: Git hooks should be installed once in `git --git-common-dir/hooks/pre-push` so main and subsequently created linked worktrees inherit the same hook without per-worktree installation. That installer originally refused foreign hooks and migrated only its own previous override. The current explicitly invoked installer replaces the pre-push file in the common Git hooks directory, configures the shared hooks path and retargets an override in the invoking worktree; it never installs commit hooks or changes other hook types. No earlier-installer recognition or foreign-hook refusal remains, by user choice. The shared hook is now installed in Factory's main `.git/hooks`; both main and the feature worktree have no override, native config links and a successful local pre-push execution. A focused consumer created a *new* linked worktree after installation, observed automatic inheritance, and performed a real local Git push that ran the conventional-message check; current tests cover replacement, override retargeting and absence of a commit hook. Before cleanup, older Factory worktrees inherited the hook but lacked root native config links, so pushes would have failed closed until their Devenv files were generated. A fresh clone still needs the explicit install task once; simply importing a module never mutates Git metadata. Exact-head Check 39204300587 passed for c0cab9141287b29522499f9b0b84a40f667a35d5; the authorized fast-forward merged it into main and manual main Test 39204543813 passed on that SHA. Local main was pulled with `--ff-only`; the retained linked checkout is a separate clean `work/main` branch at the same commit tracking `origin/main`. The two other clean linked worktrees were removed via ordinary `git worktree remove`, without deleting their branch refs or forcing removal of ignored generated caches. The docs-review branch has one unique local-only commit and no corresponding remote branch; keep its local ref until separately reviewed. Only the primary main checkout and `work/main` remain. No production Plan/Apply ran.

<!-- 2026-10-19 00:29:41 [01a14275] -->
#decision [[factory-reusable-workflows]] [[factory-downstream-github]]
Factory's Check, Test, Plan and Apply workflow source can be invoked through `workflow_call` as well as their existing direct triggers. The called workflow checks out the caller repository, so consumers must pin a reviewed Factory SHA and implement the same local flake/Devenv task interface. Check receives no secrets. Test receives only the shared organization Cachix token and runs solely for manually dispatched main. Plan/Apply remain manually dispatched from protected main, check both original and re-running actors, use the caller's protected `prod` environment for the repository management token, receive Cachix explicitly, share production concurrency, and retain the saved-plan receipt and exact fresh-plan Apply contract. Only nonsensitive state bucket, folder and GCP plan-reader inputs may override Factory's existing repository vars. A called Check job can have a different status context from direct `All`; observe it on a downstream PR and update branch protection before relying on it. Do not use `secrets: inherit`, expose production tokens to Check, or treat a caller wrapper alone as a deployment gate. The org repo has an organization-level shared Cachix secret; it does not require a new repository-level token. Moving `.github`'s root to `tf/infrastructure/` while retaining its existing bucket and `repository/prod` prefix continues to use the same state; reconcile resource addresses with temporary moved blocks, never reset the backend. Production Plan/Apply remain separately guarded. Local `test:all` and exact-head Check 39210417115 passed on c8eeea21c1f212fe373803f15997005ebf4c1d96. The user-authorized fast-forward published the same SHA on remote and local main without running production Plan/Apply or a manual main Test. The org repo had not yet switched its callers or Devenv at that publication.

#decision #incident [[factory-reusable-workflows]] [[factory-secretspec]]
GitHub reusable workflows require a caller to pass even an environment-only `GH_REPO_TOKEN` by name; declaring `workflow_call.secrets` and selecting `prod` in the called job alone did not provide it. The first approved organization Plan 39226445495 timed out while the GitHub maintainer data source kept reading: its Plan step received empty `GITHUB_TOKEN` and `REST_API_BEARER`, and no saved-plan receipt was published. SecretSpec 0.21's env provider intentionally treats an empty value as present; `required = true` and `type = "password"` do not reject it. `devenv tasks run` does not invoke `enterShell` either. Credentialed Test/Plan/Apply workflows must enter the Devenv shell to load the selected SecretSpec profile and fail early on empty required credential values; Plan/Apply callers must explicitly map the protected token, never `secrets: inherit`. Check remains credential-free. The first failed Plan cannot authorize Apply; verify the backend lock and private plan-reader route before any separately authorized retry.

#decision [[factory-shared-pi-skills]] [[factory-downstream-github]]
Factory exports portable, full-procedure deploy and Day Zero skills from
`etc/pi/skills/` through `quantile.pi.skillsDir`; its own `.pi/skills/` and
consumers' directories are populated with explicit Devenv-managed links.
`etc/pi/settings.json` lists both symlinked skill roots explicitly for Pi's
resource discovery. Both procedures retain the original private saved-plan and
new-installation phases with concrete command examples. They require a verified
operator-supplied owner/repository rather than hardcoding Factory's identity;
Day Zero supports both canonical and legacy caller variable aliases. No shared
skill may substitute a vague instruction to follow a downstream runbook, and no
existing installation may run Day Zero. `check-devenv-locks` accepts
`--flake-input factory` when a consumer's flake root follows Factory inputs;
Factory's root comparison remains the default. A consumer must still check the
actual installed state and specific pinned caller contract before any Plan or
Apply. The local migration and new shared skills are not production approval.
The shared-skills commit f9d2ea3ff305cdd56bc43cf98af8a3d258e3e401 passed exact-head Check 39215885727 and was fast-forwarded to main without a manual Test or production Plan/Apply.

#decision [[factory-dependabot-selector]] [[factory-downstream-github]]
Dependabot has no Prek-style manual mode. `quantile.dependabot.withUpdates` filters the single native `etc/dependabot/dependabot.yml` policy by explicitly chosen package ecosystems, failing on unknown/empty selections; selecting every entry returns the unchanged native file. Factory selects all four; the organization consumer selects GitHub Actions, OpenTofu and Nix without enabling an absent npm root or forking policy. GitHub reads Dependabot configuration from the committed `.github/dependabot.yml`, so Devenv manages a tracked copy, not an ignored Nix-store symlink, and `check:all` compares the index with the selected source. Importing the module does not install hooks, dispatch workflows or manage dependency updates.

#decision [[factory-markdown]] [[factory-downstream-github]]
The user chose one upstream Markdownlint native policy instead of a downstream
`.markdownlint-cli2.jsonc` fork: disable MD013 line-length enforcement in
`etc/markdownlint-cli2/.markdownlint-cli2.jsonc` so the approved organization
profile can remain unchanged. Other shared Markdown rules remain enabled.
Consumers needing stricter line-length policy may opt in through their own
native configuration, but this consumer uses the upstream template link.

#decision [[factory-secretspec]]
The shared SecretSpec runtime shell hook enforces nonempty strings for all
required exports, not tool-specific credential lists. It calls native export
and the value-free `check --json` report at runtime; the report determines
effective requiredness, preserving native profile inheritance, defaults and
scope selection without a second manifest parser. This entails two provider
resolution passes. Optional empty values remain allowed. Values never enter
Nix evaluation/store data, tracing stays disabled during handling, and errors
name only the required keys. Test/Plan/Apply retain explicit secret forwarding
and shell entry but no longer duplicate nonempty shell tests. The module cites
SecretSpec's pinned env-provider docs and `EnvProvider::get`, which deliberately
consider empty values present. This generic rule is independent of a future
GitHub provider `auth_mode = "token"` release; no upgrade was made here.

#decision [[factory-secretspec]] [[factory-age]] [[factory-native-config]]
July `devenv/secrets.nix` enabled SecretSpec by default, built the old x86_64-only SecretSpec 0.10.1 CLI from a fixed binary, installed `pkgs.age`, interpolated `quantile.secretspec.profiles` Nix attrs into a regenerated `secretspec.toml`, selected a local active profile, and bridged `config.secretspec.secrets` into Devenv `env`. Its profile declarations, GitLab pipelines, provider environment keys, project-name sanitization and `.local/` Gitignore fragment are consumer-specific, not shared Factory defaults; never put resolved values into Nix evaluation, generated files or shared assets. Factory's opt-in `nix/secretspec/default.nix` already exposes the newer pinned Devenv SecretSpec CLI, a consumer-owned native manifest (`etc/secretspec/secretspec.toml` is only Factory's own template), and a runtime shell hook that validates the effective required secrets without embedding them in Nix. Tests exercise native inheritance/defaults/scopes, nonempty-required behavior, no leaked values and fresh shell/task entry. The one generic missing tool, Age, is now an independent overridable opt-in `nix/age` module with a colocated offline synthetic key/encrypt/decrypt round-trip test; keys/ciphertext are created in and removed from a private temporary directory. No generic SecretSpec profile registry, GitLab secrets, `.local/` Gitignore snippet, automatic scaffold or secret-bearing package was added. Focused tests, flake check, `check:all`, and 102/102 Vitest passed; no publication or production workflows. [[devenv-nix-final-audit]] must verify each consumer declares its own native manifest and explicitly selects the runtime hook, tool and profiles.

#correction #verification [[factory-member-landing]] [[factory-downstream-github]]
The earlier objection to removing the organization's legacy required-PR and
maintainer-only push rules was withdrawn after rechecking the user's explicit
October 5 and October 19 architecture decisions. Consumers use Factory's
unchanged modules; do not restore those legacy restrictions. Migration Apply
39319984039 succeeded. Temporary recovery source, moved blocks and provider
alias were removed; ordinary Plan 39321902718 reported no changes and no-op
Apply 39322317684 persisted cleaned provider references. The final organization
outcome note landed at a5e701c82a56e8a37fcaea90ad78bc656d937d13. No Factory
production workflow ran during this downstream migration.

#decision [[factory-shared-checks]]
Keep check:all as consumer-owned tool orchestration, not a shared all-checks
framework. Dependabot's check package compares the Git-indexed native file to
a caller-selected expected file. check-devenv-locks --ci checks working files
and, when CI=true, the index; --flake-input retains downstream pin selection.
OpenTofu's nonempty checker owns tracked .tf/.tofu pathspec selection, and
check-terraform optionally runs -- COMMAND after backend-free initialization
and validation with the same isolated TF_DATA_DIR and absolute TF_DIR. Consumers
use this handoff for TFLint rather than duplicating the internal root hash/data
path; it also works without Devenv. Factory uses the existing Conftest check
wrapper with consumer-selected policy paths/namespaces. Imports remain inert;
no task registry, remote backend, hidden fixes or tool-specific data-path copy.

Factory implementation 78fcee21c07760b2696fac3bb929734309f3aaf3 passed Check
39329979854 and landed normally. The organization consumer adopted that pin in
c569f215998a84d77165cda830d0cc402a3fb4e6 after local backend-free validation and
Check 39330886727. Both primary local main checkouts were synchronized. This
source rollout ran no production Plan/Apply and changed no Terraform module
contents, backend or provider lock.

#preference [[factory-downstream-github]]
For a coordinated Factory/.github rollout, finish Factory's source and outcome
commits first, then pin the organization consumer to the final latest reviewed
Factory main SHA, including documentation-only commits. Do not deliberately
leave the consumer on an earlier implementation-only SHA. Keep its flake/Devenv
pins and locks, workflow callers and Terraform module references aligned.

#decision [[factory-clang]] [[factory-config-layout]] [[factory-native-config]]
For C/C++ consumers, Factory exports separate opt-in package selectors at
`nix/{bear,cmake,meson,ninja,pkg-config,gdb,valgrind}/default.nix`; each is
overridable and exposes the real Nixpkgs tool without import-time installation,
config generation, checks or hooks. GDB and Valgrind remain platform-dependent.
The shared native EditorConfig template sets four-space indentation for C/C++
source and headers. The native Prek template offers read-only `clang-format`
and `clang-tidy` manual hooks; consumers may select them with
`quantile.prek.withPrePush [ "clang-format" "clang-tidy" ]` after explicitly
providing their checker executables and native Clang configs. Clang-tidy still
requires a consumer-owned compilation database for tracked translation units;
fixes never run as pre-push hooks. Factory itself does not enable these hooks.
A focused EditorConfig consumer rejects two-space C++ indentation; per-tool
smoke tests build/run the tool and confirm package overrides. The Pi native
skill smoke now reads its public skill files during Nix evaluation rather than
relying on an unrealized store path after evaluation. Local flake check and
`devenv tasks run test:all` passed; no production workflow ran.
The signed local-cache commit 1fba32e52762adc15bbb3dc5f4d5baba8f8c48c6 passed
exact-head Check 39340693542 and was ordinarily fast-forwarded to Factory
main. The C follow-up 16ca0eee568dc7945d436da8e502556a4fb5482e passed
exact-head Check 39340723225 on its feature branch. The post-Check outcome
note followed on that branch and passed exact-head Check 39341304861;
Factory main was ordinarily fast-forwarded to 0b291a52a660d21344b5cb135d241097a1ab354c.
The user-authorized manual main Test 39341977302 passed on that exact SHA,
including checks, unit tests and Cachix processing. No production Plan or
Apply ran. This test-outcome note is documentation-only.

#decision #preference [[factory-native-config]] [[factory-old-devenv-review]]
Review the remaining committed July 12 `devenv/` entries against Factory from
a single reusable review worktree branched from current, synchronized Factory
main; keep the historical checkout read-only. The user requested this
worktree in place of reviewing from the primary checkout or creating a new
worktree per module. Historical review alone does not call for a commit, push
or merge; keep new source changes in that review worktree until the user
requests publication. The old
DuckDB shell behavior was `packages = [ pkgs.duckdb ]`, not an `enterShell`
hook; Factory already exposes `quantile.duckdb.package` for a consumer to add
to `packages` explicitly. Do not turn importing the default tool module into
implicit shell installation. EditorConfig's previously composed Makefile, Go,
Python, WAT and JS/TS/JSON sections and nested node_modules ignore now live in
the shared native `.editorconfig`; the old generated `.sql.go` exclusion lives
in the native EditorConfig Checker JSON. The C/C++, Markdown, YAML and shell
sections were already static. Shell's shared four-space default is no longer
coupled to a Nix `shfmt.indent` override; consumers changing it must patch
native policy too. Source check/fix remains explicitly consumer-owned, and
fixes do not run on pre-push. Consumer fixtures check the native indentation,
node_modules ignore and generated-Go exclusion at runtime.

#decision [[factory-old-devenv-review]] [[factory-native-config]]
Do not port the July `emacs.nix`, `jetbrains.nix`, `vim.nix`, `vscode.nix`,
`linux.nix` or `macos.nix` modules. All six only contribute complete pinned
`github/gitignore` Global template sections to an opt-in scaffolded `.gitignore`;
they do not install tools, configure an editor/OS, or run checks. Four IDE
sections defaulted on and Linux/macOS were unconditional even for other OSes.
The user uses Linux, does not want OS- or IDE-specific Gitignore/config assets,
and does not need IDE support. Keep Factory's Gitignore repository-specific;
consumers can add local ignores later without a shared module.

#correction #decision [[factory-gcp-liens]] [[factory-day-zero]] [[factory-old-devenv-review]]
GCP deletion liens must be applied manually out of band during a separately
approved Day Zero phase, never as Terraform-managed resources: their purpose
is to protect projects from Terraform misconfiguration. The committed July
backup's `devenv/gcp.nix` had an explicit `gcp:lien:apply` using `gcloud alpha
resource-manager liens create` with the project-delete restriction, optional
service-account impersonation, and a dangerous `gcp:lien:destroy` that removed
all liens. The backup `README.md` and `CONTRIBUTING.md` runbook contained no
lien step. Factory's shared Day Zero local-state reference now documents a
manual create/list and separately authorized exact-name removal; do not port
the delete-all task or give Terraform or CI lien ownership. Q0 break-glass is
not an implicit bootstrap identity. Exclude `nixbuild.nix`, `renovate.nix`,
`scaffold.nix`, `license.nix`, `readme.nix`, and the purely scaffolded
`gitlab/pipelines/scaffold.nix` from remaining July module reviews, along
with the previously excluded `assets.nix` and top-level tests. Mixed-purpose
modules with scaffold registrations remain in scope.

#verification [[factory-gcp-liens]]
On 2026-10-19 the user separately approved out-of-band project-delete liens
for the three previously unprotected, active projects under the quantile-co
folder (with Factory, quantile-co and GitHub project prefixes). The
operator's own identity lacked lien-modification permission; authorized Q0
break-glass impersonation created exactly one per project. A final read-only
check as the operator confirmed all six active projects in the organization
have a project-delete lien; three were already protected. Two deletion-requested
projects were not touched. No Terraform state/source or CI change was involved.
Keep lien names out of Git; inspect live liens and authorize an exact-name
removal individually if ever required.

#decision [[factory-old-devenv-review]] [[factory-gitlab-adapter]]
Reviewed the July backup's `devenv/gitlab/` except its previously excluded
pure pipeline scaffold. It was a GitLab-specific adapter: default glab/jq and
CODEOWNERS/insights scaffolds, opt-in Pages build, MR check/plan/LLM review and
advisory Trivy jobs, two-root fresh Terraform Plan/Apply, an OCI CI image,
scheduled Renovate and GitLab-specific SecretSpec profiles/tokens. Factory's
GitHub Check/Test/guarded saved Plan/Apply, WIF, GCS, Dependabot, Trivy,
Gitleaks and Cachix/Namespace have different explicit contracts; they do not
make Pages, automated MR review/comments or remote-state PR plans implemented.
Do not port GitLab tasks/profiles, ungated fresh Apply, implicit hook install,
scaffold generators, or the baked GitLab CI image into Factory. Any future
Pages/review/PR-plan capability needs a separate consumer and security design.
The related top-level `oci.nix` still awaits its own review. Historical
review changed no executable source and authorized no production action.

#preference #decision [[factory-tool-first]] [[factory-go]]
Keep module comments and option descriptions short and about current behavior,
not the replaced implementation or abstractions future maintainers cannot see.
Each tool owns its own checks and fixes; a language module must not aggregate
other tools' checks or generation into a generic command. Devenv tasks choose
which packages to run and in what order. Go formatters and golangci-lint are
separate; `go mod tidy` and `go generate` are explicit consumer operations,
not lint/format fixes. OpenTofu's backend-free check only initializes and
validates; TFLint runs independently against the same isolated module data.
Prek and the guarded Git/LFS hook are explicitly named orchestration, not
language-tool checks. Actionlint's native ShellCheck integration scans embedded
workflow shell, while EditorConfig's explicit EOF fixer retains its established
shared file-selection policy; neither is a generic language check bundle.

#decision [[factory-pi-web]] [[factory-shared-pi-skills]]
Factory's native `etc/pi/settings.json` selects a pinned `pi-web-access`
package by default alongside Pi memory; consumers link that settings file to
make web search and page fetching available. Keep it a normal Pi package, not
an always-on Nix CLI wrapper. Consumers independently link individual skill
directories from the existing `quantile.pi.skillsDir` into `.pi/skills/` through
their own Devenv `files`; no per-skill Nix options or automatic installation.
`deploy`, `day-zero-deploy` and `nvim-pair` are first-party skill sources under
`etc/pi/skills/`; nvim-pair originated in Quantile's self-contained July module,
not an external repository. Third-party skills are fixed-revision,
SHA-256-verified `fetchFromGitHub` inputs in `nix/pi/default.nix`, assembled by
`quantile.pi.skillsDir`: marimo-team's `marimo-pair`, coreyhaines31's `seo-audit`,
Vercel's `web-design-guidelines`, Cloudflare's `web-perf`, Addy Osmani's
`web-quality-audit` and related references/skills, and Anthropic's
`webapp-testing`. Do not check their upstream files into Factory or add another
skills lockfile. Fetches retain the original source trees/licenses; the small
reviewed Marimo patch preserves read-only registry discovery, positive PID checks
and loopback-only no-token guidance. Tests validate consumer discovery and the
patch's non-destructive behavior. Fetched sources are outside repository lint
selection; native Semgrep/Biome/permalink policy also exempts installed
`.pi/skills/`, not first-party `etc/pi/skills/`. Secret scanning remains enabled.
Marimo requires `jq` and `curl`; live Neovim/marimo processes remain consumer
responsibilities. Pi natively recognizes Anthropic, ZAI Coding Plan and Kimi
For Coding credentials; the old read-only provider catalog only chose default
model aliases for the excluded GitLab MR-review workflow. Do not recreate that
catalog or ignore the entire `.pi/` tree.

#review #implementation #verification [[devenv-nix-final-audit]] [[org-factory-consumer]]
Final consumer audit compared July 12 `devenv.nix` (a superset image with explicit C/Go/K8s/OCI/OPA/Postgres/Protobuf/Python/TF/TS/Vale/WASM enables, a Renovate package-rule override and three legacy pytest tasks) and its full imported module list against both consumers and Factory's tool inventory. The superset-only image and old pytest suites are not Factory or Org requirements; scaffold/IDE/OS/GitLab deployment, terraform-docs, ESLint and Gitignore snippets remain intentional nonports. Factory selects relevant Nix/TF/Node/Biome/Semgrep/Trivy/Taplo/Markdown/Vale/Typos/YAML/Pi/SecretSpec/Git-LFS tools and native links; `check:all` includes read-only validation, full pinned Semgrep packs and isolated Terraform/TFLint/OPA checks; `fix:all` is explicit. Added the standalone ShellCheck and shfmt checks for Factory's checked-in skill scripts and tracked-only shfmt fix, and `set -euo pipefail` to check/fix/test tasks so an intermediate failure cannot be masked. Package-script `tsc --noEmit` already checks Factory's TypeScript, so selecting the optional generic checker would duplicate it. Factory has no actual K8s schemas/manifests, application Go/Python/C/C++/WASM source, container image or database workload requiring the corresponding optional tool packages; Semgrep fixtures are not such workloads. Marimo/nvim Pi skills remain opt-in (the consumer does not run those services). Explicit Git pre-push hook is installed in the common Git hooks directory; Prek has only its chosen baseline checks (including Git/secret/commit safeguards), with other checks executed via the backend-free CI task rather than silently activating the manual Prek entries. Local `check:all` passed after the edits; 104/104 Vitest passed with four workers. One default-concurrency `test:all` run had a transient SIGKILL 137 in the golangci-lint fixture, which passed individually and in the bounded full run; the consumer's `package.json` now bounds Vitest at four workers for local and CI tests. Do not claim that first run passed. `.github` has only Nix, TF, workflow YAML and prose source and already selects its relevant existing checks, SecretSpec hook, Git/LFS, and infrastructure tasks. Its old pinned Factory SHA does not expose `quantile.semgrep.packs`/`check.configs` or the new GCP audit-log resource; do not set new options against the old pin or advance protected workflow/module/flake/Devenv references independently. At a separately authorized coordinated upstream-pin update, select local pinned security/OWASP/secrets/Terraform rules as appropriate, validate findings and review the new GCP audit config against existing service audit settings/inherited exemptions and exact Terraform Plan before Apply. No `.github` source, old backup or production workflow changed in this audit. Keep local Factory source staged and memory unstaged until publication is authorized.

#bug #decision [[factory-gitleaks]] [[factory-consumer-adoption]]
The application consumer exposed Gitleaks' recursive scan of ignored dependencies
and local files. The shared checker retains redacted full-history scanning and
its shallow-history rejection, then scans a private temporary snapshot of
tracked and nonignored untracked regular working files. It skips deleted files
and symlinks, honors Git's ignore rules for untracked files, and removes its
snapshot on exit. Tests cover ignored dependencies, generated symlinks,
untracked/modified source leaks and secrets removed from current source but
still present in history. No source rewrite or secret-check bypass is involved.
Consumers use the explicit `install:git:hooks` task; installation is never an
import/shell-entry effect.

#verification [[factory-july-release]] [[factory-storage-audit]]
Signed Factory source 99acec8 passed exact-head Check 39371988636, fast-forwarded protected main and passed manual main Test 39372264980. Authorized Plan 39373527521 produced a private saved plan verified against receipt artifact 12242591265: only the creation of `module.gcp.google_project_iam_audit_config.storage` with ADMIN_READ, DATA_READ and DATA_WRITE, zero exemptions, zero other actions. Read-only IAM policy checks found no matching service or allServices audit config at its project, parent folder or organization. After separate approval for that exact artifact, protected Apply 39374387499 succeeded. A fresh project IAM policy read verified all three Cloud Storage log types with zero exemptions. The separate Org consumer aligned to this source, passed exact-head Check and main Test, and independently applied the same reviewed audit change to its own project; that repository records its own rollout. Neither installation was recreated; no local Apply, force unlock, backend override or provider-plan payload entered Git. This outcome note changes no Terraform, Nix or workflow behavior.
