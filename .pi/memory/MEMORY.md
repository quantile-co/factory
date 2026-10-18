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
`devenv/{nix,opa,postgres,prettier,protobuf,python,semgrep,shell,tf,toml,trivy,ts,typos,vale,wasm,yaml}/`.
`devenv/{c,checkov,duckdb,editorconfig,gcp,git,github,go,json,k8s,keep-sorted,logs,markdown}/`, `secretspec.toml` and `devenv/secrets/` were reviewed and selectively ported.
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

#decision [[factory-git]] [[factory-native-config]]
Old `devenv/git` registered multiple Devenv/Prek hooks and a safety-critical installer that composed pre-push checks, legacy hooks and LFS. Factory instead offers opt-in Git/LFS/Prek/Commitizen/Gitleaks tool packages, `etc/git/.pre-commit-config.yaml` and `.cz.toml` native templates, a read-only Prek `check.package`, and `prePush.package` that buffers the exact ref stream and runs checks, an explicitly selected legacy hook, then Git LFS. The native template retains the 1200 KB LFS-exempt size limit, case/merge/symlink checks, full-SHA GitHub permalink check (excluding `.gitignore`), Conventional Commits and full-history plus working-tree redacted Gitleaks scans. The shallow-repository guard stays in the Gitleaks executable. Hook registration, Git LFS filter setup, and explicit fix commands belong to each consuming repository; importing the module never installs hooks or runs checks/uploads. Git LFS `track` can create an upload-first pre-push hook even after `install --local --skip-repo`, so downstreams must explicitly wire the checked entry point over it. The consumer test exercises actual checks, commit-message enforcement, no implicit hook installation, rejection before legacy/upload, exact ref replay, and a real local LFS upload. The old Devenv hook registry and migration/locking installer are deliberately not ported as a central Factory registry. After all old modules are reviewed, audit DevM.Nix downstream wiring against former registry behavior (see [[devm-nix-final-audit]]).

#decision [[factory-json]] [[factory-native-config]]
Old `devenv/json` installed overridable jq and configured pre-push `check-json` (strict syntax, duplicate keys, extra trailing data) with default exclusion of JSONC `tsconfig.json`; native hook exclusions could be appended or replaced. The package-only Factory JSON module retains `jq.package` and exposes overridable `prek.package` plus a read-only `check.package` that runs exactly the `check-json` hook, fail-closed from the *consumer's one* `.pre-commit-config.yaml` (`GIT_HOOKS_CONFIG` override). The optional shared native Prek template `etc/git/.pre-commit-config.yaml` now includes `check-json` with stage `pre-push`, type `json` and the old `tsconfig\\.json$` exclusion; consumers can copy/patch it or configure the hook in their own single file. Do not create a per-module full Prek config or merge registry: Prek reads one project config, and the downstream owns hook installation/order and native exclusions. A consumer test exercises jq, actual strict JSON/duplicate/extra-data failures without mutation, JSONC exclusion and native override, and no hook installation. The check package does not run unrelated hooks; importing the module does not install or enable any.

#decision [[factory-k8s]] [[factory-native-config]]
Old `devenv/k8s` installed a kubectl wrapper excluding inherited `.krew/bin` plugins, kubeconform, k9s, Helm, Kustomize, Minikube and Tilt; its read-only pre-push hook selected only `k8s/` YAML/JSON text files, required caller-supplied local schema templates, pinned schema version to kubectl by default, applied strict+summary and failed on missing schemas (no remote/default fallback or cluster operations). Factory's `nix/k8s/default.nix` exposes an overridable kubectl CLI plus its safe wrapper, kubeconform, appendable/replaceable extra tools and opt-in aggregate packages. The explicit `check.package` takes `-schema-location LOCAL_TEMPLATE` (repeatable), optionally `-kubernetes-version x.y.z` (default pinned kubectl version), then manifest files; it rejects absent/remote/default schemas and dangerous/unknown flags before invoking strict+summary kubeconform. The single optional native Prek template `etc/git/.pre-commit-config.yaml` holds the `k8s/` file selection, stage and hook entry; it ships as `manual` until a downstream explicitly switches to `pre-push` and sets its own local schema `args`. An active hook without schemas fails closed; importing the module does not install or register checks, touch clusters or force schema downloads. No real default schema can be shared by all consumers: the old JSON schema is a synthetic fixture, not production policy. The focused consumer executes valid/bad YAML and JSON against an offline local schema, rejects unknown resources and unsafe schema options, confirms nonmutation/selection and no installed pre-push hook, and proves the host Krew plugin cannot be invoked. A local Nix evaluation verified list append and mkForce replacement. [[devm-nix-final-audit]] must verify downstream schema provisioning, hook activation/ordering and tool installation.

#decision [[factory-keep-sorted]] [[factory-native-config]]
Old `devenv/keep-sorted` installed overridable keep-sorted, registered read-only pre-push `--mode lint` on tracked text with configurable shared exclusions, and contributed an explicit fix to the central fix-task registry. Its fix used a separate generated Prek config invoking `--mode fix`, reran once after Prek's rewrite-as-failure exit 1, and only allowed subsequent fixes after a clean pass; malformed blocks failed without fixing. Factory exposes opt-in `nix/keep-sorted/default.nix` check/fix packages plus the CLI and overridable Prek. The existing *single* optional native `etc/git/.pre-commit-config.yaml` has `keep-sorted` lint initially at manual stage (downstreams explicitly opt in to pre-push) and `keep-sorted-fix` at manual stage; a YAML anchor shares their exclusion regex, which consumers change there. Both wrappers fail closed if the required hook/stage is missing (Prek otherwise reports skipped hooks as success); check never fixes, while explicit fix retries exactly once after exit 1 and only returns success after a clean pass. Sorting options stay in per-file `keep-sorted` annotations, not Nix settings or a second config file. The synthetic consumer verifies actual read-only errors, clean scoped fixes after a rewrite, malformed-block failure, excluded/binary/untracked/symlink boundaries and native exclusion override. Import does not install hooks or register fixes; [[devm-nix-final-audit]] must verify downstream pre-push activation, shared exclusions and explicit fix order.

#decision [[factory-logs]] [[factory-native-config]]
Old `devenv/logs` was an opt-in, overridable `pkgs.lnav` installation with only a credential-free `lnav -V` enterTest. It had no log paths, static formats/preferences, tasks, hooks, reading at startup, or inline policy to migrate to `etc/`. Factory's `nix/logs/default.nix` exposes `quantile.logs.lnav.package` without installing/running it; consuming repositories opt into their own shell and decide which logs to open. Its one colocated consumer test runs the pinned `lnav -V` in an isolated HOME without opening a log. `lnav -V` itself creates per-user writable `.lnav` state, which is not a static Factory asset. No wrapper, central registry or tautological Nix-only tests. The final [[devm-nix-final-audit]] should confirm any downstream that previously enabled this tool now explicitly installs it.

#decision [[factory-prek-hook-ids]] [[factory-native-config]]
The single optional Prek template uses plain tool-oriented IDs without a `quantile-` prefix: `check-vcs-permalinks`, `gitleaks`, `check-json`, `kubeconform`, `keep-sorted`, `keep-sorted-fix`, and `markdown`. Generic third-party hook IDs (`check-added-large-files`, `commitizen`, etc.) stay unchanged. IDs are selectors, not executable names: entries may still call Factory-provided binaries such as `quantile-git-gitleaks` where executable names avoid host collisions. Keep wrapper selectors, tests and downstream hook wiring in sync when IDs change; no added registry or implicit hook installation.

#decision [[factory-markdown]] [[factory-native-config]]
Old `devenv/markdown` installed overridable markdownlint-cli2, generated JSONC from mergeable Nix MD003/MD013/MD024/MD029/MD033/MD040/MD041/MD060 defaults, selected tracked and nonignored untracked `*.md` by Git pathspecs, and registered an always-run pre-push check with no fix. Factory places the same rules in `etc/markdown/.markdownlint-cli2.jsonc` so consumers copy/patch native policy rather than merge Nix settings. `nix/markdown/default.nix` exposes the CLI, template path and read-only `check.package` that requires the consumer's runtime native config (`MARKDOWNLINT_CONFIG_FILE` override), selects scoped Git Markdown (optional pathspec arguments), skips nonregular/symlink files, passes exact literal filenames to CLI2 and disables config globs to prevent selection escaping the Git scope. The shared optional native `etc/git/.pre-commit-config.yaml` declares a manual `markdown` hook with `pass_filenames: false` and `always_run: true`; downstreams explicitly activate it at pre-push and optionally pass pathspecs in native args. No auto-install, hook registry, generated config or implicit fix. The consumer exercises real duplicate-heading failure/nonmutation on tracked and untracked space/glob-character paths, scoped selection and native rule override. [[devm-nix-final-audit]] must verify downstream policy placement and hook activation.

#decision [[factory-go]] [[factory-native-config]]
Old `devenv/go` combined a Nix-generated golangci-lint v2 policy, explicit gofumpt plus goimports checks, optional go-overlay toolchain, Devenv `languages.go` setup and a central pre-push/fix registry. Factory moves the reviewed linters, thresholds, denylist, formatter and exclusion settings to native `etc/go/.golangci.yml` and exposes overridable Go/gofumpt/golangci packages plus the old optional go-mockery/sqlc/templ tools. `nix/go/default.nix` exports read-only `check.package` and explicit `fix.package`; consumers pass module root arguments (and optional extra Git pathspecs after `--`), `GO_WORK_FILE` for an explicit workspace, or `GO_LINT_CONFIG` for another native policy file. The wrappers disable ambient workspaces/toolchain switching and stale GOROOT, copy tracked/untracked regular source into an isolated tree, validate local replacements/workspace paths, prohibit root escapes, omit nested/generated/vendor sources from fix selection, enforce readonly module resolution, compare module/workspace metadata before/after, and copy only selected tracked regular Go files back after a clean post-fix lint pass. They never register hooks, install packages, generate dependencies, or run implicit fixes. The focused consumer test exercises real native `godox` policy and its native override, non-mutating format failure, scoped fixes despite bad untracked/nested/symlinked files, metadata write rejection, and valid/escaping workspaces. Consumer Devenv configuration owns Go version/overlay selection, `languages.go.enableHardeningWorkaround`, package installation and hook/task wiring; final [[devm-nix-final-audit]] must verify explicit replacement of those old bindings. No extra Nix settings registry or generated YAML.

#decision [[factory-github]] [[factory-native-config]]
Old `devenv/github` combined Actionlint/ShellCheck with a central Devenv task command registry for check/build/plan/apply, an update-target matrix and mutation guard, and a Git-hook registration. Factory deliberately keeps task orchestration in each consuming `devenv.nix`/CI, existing guarded production Plan/Apply executables and Dependabot instead of bringing back those central registries. The existing `nix/github/default.nix` already exposed opt-in GitHub/Actionlint tools and native `etc/github/actionlint.yaml` plus `etc/github/dependabot.yml` templates. Its standalone checker now retains the old meaningful behavior: from the Git root, select tracked and untracked nonignored `.github/workflows/*.yaml`/`*.yml`, invoke pinned ShellCheck explicitly, disable optional Pyflakes, and let Actionlint discover consumer-native configuration (or use `ACTIONLINT_CONFIG_FILE`). Native Actionlint `paths.<glob>.ignore` can replace old Nix `ignorePatterns`; runner labels remain in the consumer file. Its existing synthetic consumer test now also rejects an actual embedded-shell SC2086 finding without source mutation. No hooks or tasks are registered by module import. The separate final DevM.Nix audit must verify downstream check/hook and task wiring; presence of an Actionlint package alone is not execution.

#decision [[factory-editorconfig]]
Old `devenv/editorconfig` mixed read-only checker hooks, Nix-generated checker exclusions and a Nix-generated, manual-only Prek EOF fixer. Factory retains the consumer-owned native `etc/editorconfig/.editorconfig` and offers `etc/editorconfig/.editorconfig-checker.json` for native regex exclusions (including its tracked `devenv.lock`, which need not end in a newline). The opt-in `nix/editorconfig/default.nix` exposes native config paths and separate read-only check / explicit EOF-fix packages. They select tracked regular text files from the Git root, skip binaries, symlinks and untracked files, and use the same native exclusion list; a missing `.editorconfig` fails checks. The fixer invokes pinned `end-of-file-fixer` only when explicitly run, repeats after its rewrite exit 1 and propagates other failures, so a successful rewrite does not block later consumer fixes. Importing the module installs neither tools nor hooks/tasks; orchestration stays consumer-owned. The focused test covers actual checker diagnostics, no mutation on check, scoped fixes, missing native config and a failing fixer. No generated Prek config or duplicate Nix exclusion options.

Semgrep's native policy is `etc/semgrep/rules/` and its ignore template is `etc/semgrep/.semgrepignore`, linked at Factory's root and excluded from Git there. The Devenv `.semgrep` directory link points at `rules/` only, so edits to its sibling ignore template do not change the linked directory's store path. `nix/semgrep/default.nix` still explicitly tests local rules and fails on source findings with metrics disabled, but no longer constructs `--exclude` arguments or uses `SEMGREP_FIXTURES_DIR`. Pinned Devenv's `files` implementation has an independent directory-symlink update bug (`ln -sf` follows an existing link to a directory). Factory explicitly imports `devenvModules.files` from `nix/devenv/default.nix`: a generic task after `devenv:files:cleanup` and before `devenv:files` removes only changed directory symlinks backed by the Nix store and recorded in Devenv's managed-files state. Devenv then recreates them; correct links and copy/seed entries are untouched. New directory declarations are covered automatically, without patching/forking upstream or enumerating leaf files. The link briefly disappears between tasks; this is not cross-process locking. Use Nix path interpolation for the desired `file` target, not `toString`, so it matches Devenv's materialized store path. The user rejected an upstream patch and a checked-in relative link. Per-file Semgrep fixture symlinks were experimentally rejected by Semgrep with misleading success status; retain the directory link with regular fixture files beneath it. Evidence: https://github.com/higherorderfunctor/nix-agentic-tools/issues/2229 and the historical merged guard in https://github.com/higherorderfunctor/nix-agentic-tools/pull/2223. Full consumer coverage is colocated at `nix/devenv/default.test.ts`. Other Nix modules were reviewed: Clang/Biome/Actionlint/EditorConfig/Pi/QMD/SecretSpec already use native assets, while Terraform's remaining flags enforce execution and saved-plan safety, not tool policy. Package-only DuckDB/GCP/Logs need no asset; JSON's hook policy is in the optional shared Prek template.

<!-- 2026-10-18 15:12:19 [01a14275] -->
#decision #todo [[factory-old-devenv]] [[devm-nix-final-audit]]
After reviewing and selectively porting every old DevM/Devenv module, do a separate end-to-end audit of DevM.Nix's consuming configuration against the old registry-driven behavior. Inventory every previously registered hook/tool/task (especially Git pre-push, commit-msg, LFS order, secret scans and explicit fixes), map it to explicit downstream `devenv.nix`/native configuration or document an intentional omission, and verify actual execution rather than merely finding packages/options. Do not silently change the old checkout's unrelated dirty work or enable hooks on Factory module import; arrange any DevM.Nix edits as separately reviewed consumer integration.

<!-- 2026-10-18 16:26:50 [01a14275] -->
#preference #decision [[factory-old-devenv]] [[factory-batched-ci]]
During the remaining old Devenv module-by-module reviews, do not merge each module to main or trigger GitHub workflows after each module. Keep and validate changes locally; batch publication and branch CI after a sensible group or when the user asks. Preserve the protected-main and exact-head Check gate for an eventual merge, and never run a manual Test or production Plan/Apply without separate authorization. Review and commit sanitized project memory alongside the eventual implementation commits rather than making separate per-module outcome-note/Check cycles.