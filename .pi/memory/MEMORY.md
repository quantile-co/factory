# Factory project memory

## Active backend

#deployment [[factory-layered-state-backend]]
On 2026-10-25, protected state-only run `40172046339` migrated the default
workspace in the existing bucket from `repository/prod` to
`factory/prod/infrastructure`. Native locking, private create-only backup
readback, unchanged lineage/resources/outputs, expected serial increment of one
and generation-bound retirement of the old live object were verified.
OpenTofu may reserialize transient variable-check metadata; resource state is
unchanged. The migration itself performed no resource Plan/Apply or publication.

The subsequent authorized lifecycle retired only the unused `non-prod`
environment and its branch policy (Apply `40175260155`). Both published Factory
packages are live at `0.1.1` after Build `40175882660` and operator npm 2FA approval.
Cold starter initialization may fetch pinned tool closures; source locking and
subsequent warm-entry checks remain offline.

Protected cleanup Apply `40177402792` deleted provenance-known migration backups,
logs and obsolete state generations by exact generation URI. Current state,
active plans, locks and bucket protections were excluded. GCS soft-delete
retention still applies; it was not disabled to force physical purging. The
original CLI is restored; no temporary migration/maintenance code, tests,
templates or compatibility path remains. Old prefix references below are
historical; consumed saved-plan approvals must never be replayed.

Current source, tests and deployment skills take precedence over these notes.

## Memory policy

#preference [[factory-memory-publication]]
Keep only durable repository decisions, unresolved issues and deployment outcomes.
Do not retain machine-specific paths, credentials, environment details, temporary
files, session handoffs, routine check counts or investigation transcripts.
Reconcile unique publishable notes before removing duplicates. Commit sanitized
memory with related changes; do not create recurring note-only validation cycles.
Private consumer guidance belongs in the private repository, never here.

#preference [[lean-native-operations]]
Prefer existing native tool roots and the minimum necessary verification,
especially for small or not-yet-used repositories. Avoid extra frameworks,
directories, test sprawl and repeated broad checks; remove one-off tooling after use.

## Architecture and consumer conventions

#decision [[factory-config-layout]] [[factory-native-config]]
Factory is a shared Nix flake, not a shared shell-task framework. Use tool-owned
`nix/<tool>/default.nix` modules with meaningful colocated tests and native assets
under `etc/`. Every module directory under `nix/`, including the root, has a `default.nix`; native annotated test fixtures remain data.
Root and intermediate defaults only wire imports/exports through adjacent directory
entry points. Leaf defaults own the implementation, normally beside `default.test.ts`;
do not introduce `module.nix` or other forwarding-only splits for leaf implementations.
Treat `etc/` only as template sources for Nix modules. Runtime root configuration
and companion assets must be copied from the Nix store into their
tool-native locations, including `.vale/`; never load runtime assets
directly from the checkout's `etc/`. Source linting and template tests still
inspect those sources. All exported Nix options live under `config.quantile-co.factory`;
`nixModules.default` combines named modules without installing tools or hooks.
Consumers select packages, native configuration and task orchestration explicitly.
Keep reusable source formatting in the owning tool module: `biome.formatFile`
accepts a destination filename and store-backed source for native root copies.
Consumers inline trivial JSON reading rather than adding local helper libraries.
Keep configuration native rather than inventing Nix settings registries or tool
bundles. Reusable executables read consumer configuration at runtime and remain
independent of shell and CI orchestration. Keep Terraform native under `tf/`.

#decision [[shared-typescript-config]] [[release-source-provenance]]
TypeScript, Knip and Firebase defaults are native Factory assets. Consumers
materialize project overrides as regular files. Public source releases are
created from a reviewed Git commit plus that commit's pinned generated regular
files in an isolated checkout; downstream builders receive a complete archive.
Never package mutable operator working-tree files.
Bind the resulting archive and deny-all Rules to the immutable release digest.

#preference [[factory-consumer-migrations]]
Keep migrations minimal and aligned with public quantile.co. Consumers extend
small `nix/` modules rather than adding an `etc/` directory. Order applicable tasks
install → check → fix → test → build → plan → apply. Keep descriptions brief and
intent-focused; reserve comments for non-obvious safety rationale. Project
descriptions match the GitHub description and README byline.
Use existing modules and workflows as-is rather than preserving obsolete policies.
Remove migration scaffolding after successful adoption and prove convergence.

#decision [[factory-flake-direnv]] [[factory-managed-files]]
Factory uses a locked flake shell and the same `.envrc` through direnv locally and
in CI. Pnpm/Turbo workspaces separate thin commands in `apps/` from importable
behavior in `packages/`. The three apps are Nix, GitHub and repo; the three
packages are Nix, GitHub and Pi. Code packages use `src/` with colocated tests and
`index.ts` for actual root public entry points. Nix exposes separate `files` and
`semgrep` subpaths without a forwarding barrel. Single-file CLI apps use root `cli.ts` entry points.
Build tooling, manifests and skill assets remain at package roots. Native
`pnpm install --frozen-lockfile` installs JS
dependencies and runs the root `prepare: husky` hook. Dependency install scripts
remain disallowed through pnpm's explicit build policy. Set
`verifyDepsBeforeRun: false` in the workspace configuration to disable automatic
installation. Install explicitly before local tasks, as documented in the README.
Each workflow runs `pnpm install --frozen-lockfile` immediately before its pnpm
task in the same run block, never a separate setup step or installer wrapper.
A failed frozen install stops the block before the task. Build artifacts separately with `pnpm run build`;
validation can rebuild declared prerequisites. Turbo caches only reproducible build outputs;
checks, tests, fixes and Git/index/native-sensitive work remain uncached.
Local caching is the default; CI may opt into Namespace remote caching through
native TURBO_CACHE/TURBO_TOKEN. Protected Plan/Apply remain workflow-only.
`flake.nix` declares native destinations/sources/modes through the files module and
explicitly selects `files.shellHook`, which runs the cold `factory-files write`
command from the runtime Git checkout root. Copy overwrites
like Devenv, seed keeps existing contents, and neither creates symlinks. Both
modes reject symlink destinations, including Nix-store links; operators must
replace those explicitly. All selected destinations are checked-in regular files. Check requires them in the
Git index and compares copies with their source and index so entry cannot hide
committed drift. Q0 remains
Factory-independent. Pi owns the opt-in `pi.shellHook` for runtime checkout-local
memory exports. Factory explicitly selects it through `flake.devShell.shellHook`;
module imports alone do not activate it. Compose file reconciliation before Pi
memory setup. These native shell hooks run for both direnv and `nix develop`;
replaying the cached `nix print-dev-env` script also reruns them. Direnv retains
only pre-evaluation local configuration/cache trust and `use flake`. Those settings
cannot move into a shell hook that runs after Nix evaluation.

#decision [[factory-shared-file-ownership]]
Native templates cover Gitignore, Husky pre-push, direnv, README seeds and explicit
license/notice selections. Keep the proprietary template named `PROPRIETARY`.
Consumers patch sources before `copy`; there is no separate patch mode. README
uses `seed` and remains repository-owned after creation; preserve its H1,
Prerequisites, Development and Skills presentation. Never infer a repository's
license or replace its third-party notices. Commit `.envrc` copies for bootstrap;
normal direnv approval remains required. Keep domain-specific deployment guidance
in consumer references and share only applicable entry points/procedures. Q0 stays
independent.

#decision [[factory-declarative-flake]] [[factory-package-exports]]
Keep repository inputs, systems and explicit selections in `flake.nix`. All Nix
entry points are modules, including the root, flake and files modules; no parallel
`lib.mkFlake`/`lib.mkFiles` API. A small per-system `lib.evalModules` bootstrap
passes `pkgs` and `factoryInputs = factory.inputs` when importing the aggregate
`factory.nixModules.default`. Factory-owned llm-agents/Semgrep inputs come from that
pinned Factory input, never redeclared floating consumer inputs. Named Pi/QMD
modules receive `llmAgents = factory.inputs.llm-agents`; named Semgrep receives
`rulesSource = factory.inputs.semgrep-rules`.
`factory.flake.packages`, `factory.flake.devShell.packages` and
`factory.files.entries` are explicit selections; evaluated `factory.flake.outputs`
provides per-system outputs. The generic files module preserves store references
and packages the same stdlib implementation as `packages/nix/src/files.ts`, with no workspace
node_modules requirement and no README/license knowledge. The Nix package also owns
curated Semgrep pack assembly; `apps/nix` dispatches these two operations. Native
`nix/files` and `nix/semgrep` modules retain configuration and dependency ownership.
The manifest-bound `factory-files` command remains the cold-bootstrap entry point. README/license assets
and renderers stay with their own Nix modules under `etc/readme`/`etc/license`. Prefer explicit `packages.<system>.<name>`
exports using upstream names, including `nodejs_24`, over generic package-only
modules. Explicitly selected tool modules may retain native package options.
GitHub workflows use the normal JS workspace, not a second self-contained Nix
CLI build. Workflow YAML calls consumer-owned `github:plan` and `github:apply`
pnpm tasks, never Factory workspace paths. Factory restores the repository root
and runs its TypeScript CLI with locked `tsx`; the GitHub library exports source.
Both workspaces have optional Vite builds; workflow execution continues to use
source through tsx without a build prerequisite. Type checking remains separate,
and protected Plan/Apply bypass Turbo. Workflows install with the frozen lockfile immediately
before the task in the same run block; phase credentials stay scoped to that block. Consumers own their JS dependency delivery
and task implementations; Nix supplies runtimes, provider tools and workflow templates. Check/Test/Build continue using their existing pnpm tasks;
repository check/fix/test scripts dispatch directly to `apps/repo`.
Unsupported or broken exports are omitted for that platform. Factory enables
unfree packages in its own Nixpkgs instance; host configuration is unchanged.
Keep public package assignments explicitly qualified and development-shell tools
in one continuous qualified list. Factory's native `statix.toml` disables only
`manual_inherit_from` to permit that style; other rules remain enabled.
Exports alone do not build packages or publish caches. Downstreams must replace
removed package-only module imports/options when updating their Factory input.

#decision [[factory-development-rules]]
Root copies serve Factory development rather than mirroring the reusable catalog.
Select custom Terraform rules and pinned TypeScript, Terraform and GitHub Actions
packs. Packs are YAML under `.semgrep/packs/` so native directory scans load them;
upstream metadata is excluded from formatting, spelling and permalink policies,
not from rule validation or scanning. Docker, Go and Kubernetes rules remain in
the reusable catalog and its tests. No Nix Semgrep pack is available; keep the
existing Nix checks. OPA and Conftest independently select explicit Rego paths,
reject empty checks and prevent policy traversal without a shared shell fragment.
Third-party Marimo skills are used unpatched.

#preference [[factory-test-value]]
Use small behavioral regressions for Factory-owned boundaries. Avoid configuration
snapshots, tests of upstream behavior, unnecessary abstractions and repetitive
validation. Minimize new files, directories and abstractions; add them only when
required and list the additions at task completion. Declare runtime dependencies
through pinned inputs/locks; never weaken
assertions or skip coverage to conceal missing dependencies.
Keep comments about current behavior, not historical migration narratives.
`AGENTS.md` stays a navigation index. README edits require explicit approval.

Check implementations do not mutate source or managed configuration and do not
embed dependency/hook installers. Native pnpm automatic installation is disabled.
Workflows install explicitly immediately before the task in the same run block,
not through a separate step or action. Reproducible ignored build
artifacts remain permissible prerequisites. Source fixes are explicit. Husky's tracked
pre-push entry point runs direnv checks before LFS upload, without additional hook
chaining. Run checks in a subshell with Git's repository-local hook environment
cleared, so nested root lookups and module clones resolve their own checkouts.
Keep the original push environment and refs for LFS.
No commit-time hook or implicit shell-entry installation is intended.

## Shared Pi extensions

#decision [[factory-pi-extensions]]
Use one guarded first-party Pi extension with a small registration entry point at
`packages/pi/src/index.ts`. Keep implementation flat within `src/`, with
single-word filename stems and colocated tests. The entry point wires plain
dependencies into consumer-owned interfaces. Git/Herdr/direnv/terminal modules
remain independent of the Pi SDK inside this package. Extract another package
only when an actual additional consumer needs it. `pi.ts` owns Pi registration,
sessions and SDK UI integration; `git.ts` owns Git inspection and protections; `herdr.ts` owns
Herdr workspaces, agents and reconciliation; `terminal.ts` owns foreground process
execution and terminal restoration; `direnv.ts` owns worktree environment approval;
`model.ts` owns the one-time child selection policy over native Pi registry APIs;
`langfuse.ts` owns the optional classifier observation adapter.
Keep these boundary implementations independent of the Pi SDK. No dependency-injection framework, service registry or interface per helper.
Tests inject boundary dependencies rather than mocking sibling modules, retaining
real Git repositories and Pi session files where their behavior matters.
Author runtime behavior in packages, not `etc/` or generated `.pi/` copies.
`packages/pi` is a native Pi package with explicit independently selectable
extension/skill/prompt/theme manifest paths. Herdr integration is selected
independently through native Pi settings, without Factory vendoring. Consumers select native
Pi package resources and Pi/Herdr/Git/shfmt binaries explicitly, without copied
shared `.pi/extensions`/`.pi/skills` trees or a runtime bootstrap. Shared Pi settings select pinned upstream memory,
web-access and Langfuse packages; Pi installs those npm packages after project
trust, not during the Nix build. Enable native codemode and tool search additively
through `defaultTools`, retaining ordinary tools and codemode's default `on` mode.
Show cache-miss notices without changing cache warming. Codemode's nested tool
calls retain Factory's checkout guards through Pi's native execution pipeline.
Langfuse credentials and telemetry destinations
remain operator-managed and outside Git/Nix outputs. Factory owns the
foreground-terminal handoff tool alongside its worktree tools; hardware-cursor
customization remains personal. Shared integration covers Pi built-ins,
Factory-owned tools and declared dependencies, not personal extension collections.
Use foreground-terminal for requested interactive programs and ordinary Bash for
captured output. Do not add a tool wrapper for every CLI or a plugin framework.

#decision [[factory-skill-distribution]]
Keep upstream skills unchanged. `packages/pi/package.json` owns the top-level
`skills` declarations with full Git commit pins and positive selections.
Consumers install this package as a direct dependency and explicitly run pinned
`skills@1.7.4 experimental_sync --agent pi --copy --yes`; Factory exposes
`pnpm run skills:sync`. Persist downstream `--include`/`--exclude` filters using
`@quantile-co/factory-pi#skill-name` patterns in that task. Synchronization writes
ignored `.agents/skills/` and a reviewed `skills-lock.json`. The experimental
CLI's lock hash is provenance, not an enforced frozen artifact checksum.
Do not run sync during install, builds, shell entry or Pi startup. Native
`.pi/skills/` remains a valid authored source directory and is not excluded from
shared linting; ignored `.agents/skills/` holds synchronized external resources.

The package ships only Factory's extension and two first-party deployment
skills under `skills/`. Its native `pi.skills` is empty:
the CLI synchronizes the shipped skills too, avoiding double activation.
Pstack `unslop` replaces avoid-ai-writing without executable helpers; upstream
makes it explicit-use. Matt's five selected skills and his setup skill are
unchanged; running setup or installing anti-slop lint rules remains a separately
approved repository operation. Do not enable Superpowers bootstrap implicitly.
Upstream skill distributions retain their own licensing. Factory does not copy
or aggregate the upstream catalog. There is no Factory skill-patching or
vendoring framework.

`etc/pi/settings.json` is the only native settings template. Factory overrides
only its local package source when materializing `.pi/settings.json`.
Preserve the five exact upstream npm recommendations. SDK-only settings entries
do not activate resources; Factory bundles its declared SDK dependencies from
the workspace lock rather than searching Pi's installation directories.
Npm transitives installed independently by Pi do not inherit the workspace lock.

Nix supplies available skill binaries; downstreams independently choose their
skill filters and development-shell packages. Do not add missing-binary warnings,
automatic installers or a dependency registry. Curl, FFmpeg, yt-dlp, Marimo,
Google Lighthouse, xdg-utils and libsecret are exports, not Factory shell inputs.
The Lighthouse web-audit package is `google-lighthouse`, not `lighthouse`.
There is no nvim-pair skill or Neovim export. Downstreams own Python Playwright
SDK dependencies through their language manifest; Factory's existing Playwright
module remains browser-only. Services, authentication and desktops stay external.

`herdr_worktree` is the model-facing start/reconcile tool; there are no extension
slash commands. Start uses native Herdr worktree and agent commands, preserves
parent focus and session, and forks the conversation with Pi's SessionManager
unless `context: fresh` is requested. In-flight tool batches are excluded from
the child context. Existing occupied workspaces are not replaced or prompted.
Native terminal readiness is not Pi input readiness: wait for the bundled Herdr
integration's session-start report before prompting. Require Herdr's observed
activity gate before reporting task acceptance; a successful terminal write is
not acceptance. Fail closed on blocked, missing or changed agents and never
resend an uncertain prompt automatically.
Before starting a child, reuse native direnv approval only when the primary's
regular, committed `.envrc` is already approved and the worktree copy is identical.
Do not inherit approval over a worktree `.envrc.local` or explicit direnv denial.
An independently approved worktree remains usable; an unapproved primary needs
one operator review and `direnv allow`, not a directory-wide whitelist. This
preflight never evaluates either environment or bypasses hooks.
Failures preserve partial workspaces/sessions for inspection instead of retrying
uncertain mutations. A Git-directory launch lock coordinates Pi processes;
inspect an abandoned lock before removing it manually.

#decision [[factory-child-routing]]
Child model selection happens in the parent before spawning, using current API
context, never environment model variables or restored session defaults. Omitted
`model` means `auto`; `model: inherit` avoids classification. Exact physical
`provider/model` and thinking overrides take precedence. Both fresh and fork
launches carry explicit provider/model/thinking CLI arguments; forks also record
native model/thinking entries. There is no virtual provider, per-turn switching,
new permission policy or parent model change.

Auto uses native `typesafe/jev-latest` with saved login, sending only the submitted
task text, never session messages or files. Keep tasks free of code and secrets;
the small local refusal heuristic is not a secret scanner. Insufficient or
oversized tasks inherit without classification. Topic keywords are not a local
gate; risk is classifier-assessed.
Jev answers typed complexity and risk questions within five seconds. Finite label
probabilities of at least 0.9 for a known complexity and at most 0.05 for risk
permit routing; these are policy thresholds, not task-success estimates. Missing
classifier/auth, errors, uncertainty or unsafe candidates inherit both current
settings except deliberate overrides. Cancellation aborts launch. Returned
classifier usage enters native tool accounting, including launch failures.

Factory's classifier observations reuse the Langfuse plugin's existing SDK
provider and published active-turn context; they do not create exporters or read
credentials. Declare the tracing SDK and its OpenTelemetry API peer as normal
package dependencies and bundle them under the workspace lock. Use the SDK's
public shared-provider API; never search Pi's npm installation directories. Record actual classifier model, labels, timing and usage,
not task text or raw provider errors; an unpriced catalog entry is not free usage.
With a recording span, defer only Factory's usage to the enclosing tool result's
native `message_end`, preserving Pi totals without the plugin's duplicate,
parent-model-attributed generation. Track nesting through `parentToolCallId`, not
ID parsing. Missing/inactive tracing retains ordinary tool usage. Recheck this
bridge when upgrading Pi 1.4's finalized-message hooks or Langfuse plugin 0.1.2's
`tool_execution_end` accounting; this is not general classifier instrumentation.

Auto stays on `openai-codex` and intersects the available registry snapshot with
any current parent scope. Scope is a cycling preference, not a security boundary;
explicit model choices may intentionally go outside it. Conservative tier order:

- Routine: GPT-6 Luna, then GPT-5.6 Luna; high thinking.
- Standard: GPT-6.1 Sol, GPT-6 Sol, then GPT-5.6 Terra; medium thinking.
- Hard: GPT-6 Astra, then GPT-5.6 Sol; high thinking.

These roles follow [Codex model guidance](https://developers.openai.com/codex/models/),
[model selection](https://developers.openai.com/api/docs/guides/model-selection),
and the GPT-5.6 [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) descriptions;
they are starting policy, not cross-generation equivalence or subscription price
claims. Native registry capabilities take precedence over API product limits.
Validate effective thinking without silent clamping. Fork auto routing never
shrinks the parent's declared context window, even if recent measured usage is
small; use fresh context or a deliberate override when appropriate. Unknown
parents/providers inherit. Unknown eligible Codex models or an entirely uncovered
tier produce a tool-result warning and a deduplicated parent UI warning on launch;
missing individual legacy versions do not. Review policy rather than silently
expanding scope or selecting unknown models.

Startup verification uses a native Factory CLI flag and `session_start` handler.
The child records its actual available physical selection, API, context capacity,
credential-source category and OAuth mode in a private atomic receipt in a unique
launch directory under the Git lock. Fresh sessions need this receipt because
native setup-only entries are not persisted before the first user message.
Compare the snapshot and session ID/path/cwd with the requested launch and Herdr's
session report before sending any task. Clean only the owned launch directory;
a delayed old child cannot write into a newer launch's directory. Missing or older
Factory handlers, declined project trust, mismatches and timeouts fail closed
without prompting or replacing the child. Adopt compatible Factory copies before
reloading a parent expected to launch into older consumer checkouts.

Virtual selection inheritance, extension-registered providers and runtime API-key
overrides are unsupported; require a usable physical alternative rather than
calling an inaccessible router or copying credentials. A virtual parent also
requires explicit physical thinking because router-defined levels are not
necessarily physical reasoning efforts. Matching source category
is not proof of the same account, billing source, endpoint, all model overrides or
successful future authentication. Verification is a startup snapshot, not a
sandbox against later user/extension changes. No credential resolution or provider
inference is performed to prove access. Occupied children and reconciliation do
no selection/classifier work.

Worktree roots resolve from `PI_HERDR_WORKTREE_ROOT`, then repository-local Git
config `pi.herdrWorktreeRoot`, then `.worktrees` beside the primary checkout.
Relative overrides resolve against that primary checkout. Git metadata identifies
checkouts; filesystem names and Herdr labels are not repository identity.
Destinations must retain the primary checkout's ancestor context guides. Keep
machine-specific roots in local configuration, including devbox provisioning,
not shared repository files. This does not impose a workstation directory layout.

The guard operates without Herdr, uses shfmt's Bash parser, and blocks primary
checkout file edits and Git mutations, including switch/checkout and GitHub PR
checkout. Verified `--ff-only` pull/merge syncs of main's configured remote main
branch do not require a second confirmation, including without a terminal UI.
Other refs/options and missing upstreams remain blocked; Git rejects divergence
and conflicting local edits without resetting or stashing.
Branch drift and unresolved Git targets stop mutations; never automatically
switch back, stash, reset or copy uncommitted files. Bash, foreground-terminal
calls and Pi's user shell input are checked; PowerShell is unsupported. This is
an accidental-action guard, not an OS sandbox: arbitrary scripts, other tools,
interactive subprocess input and external processes are not fully inspected.
Read-only tools remain available for diagnosing drift.

Global-to-project cutovers are operator-local migrations, not personal extension
paths or exclusions baked into shared settings. Remove global copies only after
the relevant repositories have adopted validated project-local replacements;
unrelated repositories must not lose integration silently. Herdr and Pi must be
available in the child pane's shell; a blocked startup/trust prompt is reported,
never automatically approved or bypassed.

## Dependencies, credentials and caches

#decision [[factory-npm-distribution]]
Publish Factory Pi and GitHub packages publicly through npm; the root workspace
and remaining packages stay private. Package builds and staging run on Namespace,
not GitHub-hosted runners. Artifact building/publication uses `build.yaml`, named
Build, with Infrastructure and Application jobs. Callers select applicable layers;
`github.workflows.build.layers` can differ from the shared deployment selection.
Factory selects Application and its repository-owned `github:build` task qualifies
and packs reviewed main before supplying the prod `NPM_TOKEN` to npm staging.
Use a scoped, stage-only granular token without 2FA bypass; an npm maintainer
approves each staged version with interactive 2FA. Staging a new package creates
a public placeholder, so staging itself requires publication approval. Inspect
partial/uncertain staging before retrying; do not automatically approve or rerun.
`pnpm run npm:pack` runs ordinary validation and packs both public packages;
`npm:stage` stages the existing qualified tarballs without rebuilding. Pnpm
packing applies the GitHub package's publish-only compiled exports while its
workspace source export preserves build-free tsx Plan/Apply. Pi host SDK peers
are optional to avoid installing duplicate physical host packages downstream.
Consumers pin exact npm versions and integrity through their committed lockfiles.
Credentials never enter Nix values, source, artifacts or build definitions. No
additional license is inferred for bundled dependencies: Factory is MIT, and
package archives retain its license and the bundled dependency notices. Keep
registry-specific credentials and publication behavior in the owning app/flake,
not in shared Build YAML or separate package-specific workflow templates.

#decision [[factory-moving-flake-refs]]
Moving flake refs resolve through the committed `flake.lock`. Generated Dependabot
configuration must be a committed native file, not an ignored link. Consumers
resolve Factory through the committed flake lock; Terraform module refs may lag
a compatible flake revision. Existing checks and tests provide behavioral
coverage without a dedicated version-alignment gate.

#security [[factory-production-flake-source]]
Use Git-aware flake references, never `path:.` for a checkout containing runtime
credentials or infrastructure data. Credentialed workflows enter the same direnv
shell as local development, then pass credentials to process environment only;
never put resolved values in Nix outputs. Keep backend coordinates and exact
saved-plan identity checks. Forward named secrets explicitly, not `secrets: inherit`.

#decision [[factory-cachix-policy]]
Check receives no production or cache-writer credentials and never publishes remote caches.
Credentialed main workflows
select the cache named after the caller's GitHub owner, configure authenticated
reads, and publish through the pinned Cachix action. Private derivations must
never be uploaded to a public cache. Cache credentials never enter source, state
or Nix outputs. Preserve signatures and repository/profile cache isolation.
Namespace volume caches are best-effort; a cache-action message does not prove a hit.
Turbo persists .turbo/cache alongside /nix, with existing repository/profile volume
isolation and main-only snapshot publication. One remote Turbo team main is shared
within each caller workspace. The native TURBO_TOKEN name selects a read-only
organization/repository secret or a writer override in the existing prod
environment. Test, Build, Plan and Apply use prod wherever they exist, with no
separate cache environment. Trusted main Test/Build may write; internal Check
receives a reader and external/fork PRs no remote token. Developers use
server-scoped readers; client read-only flags alone are not authorization.
Restricted-runner authentication and real remote hits were verified with a scoped
reader; read-only uploads were denied. The temporary qualification writer was
revoked. CI readers are installed; permanent prod writers and complete cross-run
qualification remain pending. The rejected separate-environment plans are obsolete
and must never be applied. See the deployment configuration
reference for credential scopes. No additional cache setup action is needed.
Do not dispatch production workflows just to warm caches. Keep public cache
additions in `.envrc`'s `NIX_CONFIG` for trusted stores in both CI and local use;
untrusted daemon clients leave caches and keys to administrator configuration.
Cachix's user-level configuration can override install-time additions. Keep `require-sigs = true` in
the Nix install action before entering direnv. Preserve authenticated caller
cache reads alongside every approved public cache.

## Infrastructure and production

#decision [[workflow-timeouts]]
Use explicit job timeouts of 15 minutes for Check/Test, 30 minutes for Build/Plan
and 120 minutes for Apply, wherever those workflows exist. Do not add placeholder
workflows. Keep deployment guards, locks and concurrency unchanged.

#decision [[factory-terraform-layout]] [[factory-saved-plans]]
The deployment root is `tf/infrastructure`; shared GitHub and GCP modules are
separate under `tf/modules/project/`. Existing deployments retain their bucket,
backend prefix and lineage. Explicit address moves are temporary migrations,
not permission to recreate an installation.

Plan/Apply remain manual, protected-main operations with protected environments,
WIF, backend locks and non-cancelling concurrency. There are no owner-roster actor
or triggering-actor conditions in YAML. Platform authorization remains in GitHub
repository/environment policy and the existing WIF/IAM configuration. Workflow reuse is file-based: Factory maintains native YAML under
`etc/github/workflows/` and one Nix module with template options at
`nix/github/workflows/default.nix`. Rendered YAML is pure store data, readable
without import-from-derivation or target-platform builders when consumers patch
it during evaluation. Consumers other than independent Q0 materialize
the files explicitly and own their task-specific input validation, release
logic and post-Apply checks. Do not add downstream-application-specific logic
to shared templates. Workflows pass the logical `--tf-layer` to repository-owned
pnpm tasks/apps, which map it internally to the root and existing backend prefix.
Shared YAML owns neither filesystem layout nor backend identity. Factory's app
supports Infrastructure only, mapped to `tf/infrastructure`, with the prepared
`factory/prod/infrastructure` backend target. Runtime
transport is importable `packages/github` behavior with a thin Commander app.
Library callbacks receive the exact saved-plan path, not an ambient TF_PLAN_FILE.
Commander reads the credential through native `.env()` and also accepts its
optional flag. Workflows use environment-based credentials and pass trusted
repository vars directly as quoted CLI arguments. Apply bridges its operator input
through `GH_PLAN_REF` with a short safety comment, then passes the quoted variable
to `--gh-plan-ref`; this is not a CLI environment input. Google authentication
keeps its actions-managed files. Native Actions
metadata is read directly rather than repeated as flags. The app derives only
explicit provider variables, never forwarding ambient TF_VAR/backend input wholesale.
Cancellation waits for owned process close and bounds process-group termination;
private scratch ownership is atomically fresh and regular plan files are required.
Deployment skills use the consumer's selected root. Local exceptional commands
live in deploy skills; the namespaced workflow task entry points do not authorize
local production execution. A merge or green Check is not deployment approval.
Plan writes a local saved file and private log; workflows use `gcloud storage cp` to persist
these in private GCS, then download the operator-selected exact plan generation
for Apply without replanning. There are no GitHub artifacts, producer-run checks
or metadata manifests. Keep main fixed during review. Never replay an uncertain
Apply, force-unlock an active writer or rerun Day Zero.

#decision [[factory-member-landing]]
Repository writers may fast-forward main after exact-head required checks, without
bypassing protection. PRs are optional and squash-only; auto-merge remains off.
Retain signed commits, linear history and no force pushes/deletions. Do not restore
legacy required-PR or maintainer-only push rules during consumer migration.

#decision [[factory-plan-readers]] [[factory-storage-audit]]
Human plan-reader IAM is limited to `plans/`, not state or administration. An
existing authorized reader must review the initial grant plan before Apply.
Storage audit configuration enables ADMIN_READ, DATA_READ and DATA_WRITE without
exemptions; inspect existing service configuration and inherited exemptions before
rollout. Project-deletion liens stay manually managed outside Terraform, with
separate authorization for creation or exact-name removal. Never bulk-delete liens.

#decision [[factory-qmd-ownership]]
Seed `.qmd/index.yml` as a checked-in, repository-owned native configuration,
not a refreshed copy. Factory supplies canonical bootstrap collections and the
pinned QMD built-in model defaults; ordinary Pi memory startup must not dirty it.
After creation, each repository owns all collections, contexts and models:
upstream seed changes do not replace existing configuration. Native YAML model
values take precedence over environment overrides. Review intentional changes
in Git; preserve existing custom values, memory, indexes and caches during adoption.
QMD writes resolved model defaults and normalizes YAML even during collection
listing, so keep the bootstrap seed canonical and verify startup on QMD updates.

## Configuration contract

#decision [[configuration-contracts]] [[project-membership]]
The [configuration contract](../../packages/pi/skills/deploy/references/configuration.md) defines
canonical names and platform namespaces.
Concrete Terraform roots own paired `local.project_owners` and
`local.project_members` source records and project emails/usernames directly into
independent GCP/GitHub module inputs. They are not runtime inputs.
Do not add an intermediary identity module or registry. Platform modules own
permission logic. The approved member policy grants GitHub repository write
access only, with no added GCP or WIF grants. Members never enter the owner-ID map. Existing owner views retain plans-only
human reads and main/repository/actor-scoped WIF, not direct human project Owner
grants. Review inherited permissions and trusted workflow source separately.

Owner/member records live only in Terraform source for platform permissions. The
CLI reads no roster environment input and forwards no roster `TF_VAR_*`. No Actions
owner roster, variable resource or adoption import is part of this contract.
Removing the YAML actor conditions is intentional; do not claim those checks remain.
Retiring historical live variables is a separate operation, not implied by source cleanup. The old
independently editable maintainer arrays and bucket/folder compatibility aliases
are no longer the source contract. Native
provider names remain boundary exceptions. The `module.github` to `module.gh`
address migration is complete; the temporary move is retired. Canonical owner and
bucket settings were separately approved and activated. No source change
authorizes live variable updates, IAM changes, Plan or Apply.
Factory's concrete root uses approved billing/folder literals, verified against
Resource Manager and Billing metadata. Cloud Asset Inventory reports its existing
state bucket in US in the expected project; direct Storage metadata access was
unavailable to the reader. Shared workflows no longer forward billing/folder
overrides. Verify each consumer's own deployment values before its migration;
never copy private identifiers into public Factory. These IDs are not credentials,
but publishing them reveals account/hierarchy metadata and does not replace IAM
review. Factory's owner pairing is confirmed; other installations must confirm
their own rosters. Reusable module parameters remain configurable.

Use `GH_REPO` for the repository selector. The stored repository credential,
workflow environment variable and Commander `.env()` all use `GH_REPO_TOKEN`;
its optional flag is `--gh-repo-token`. Keep organization credentials distinct as
`GH_ORG_TOKEN` or organization-qualified names when needed. The CLI maps its one
resolved repository token to native `GITHUB_TOKEN` and `REST_API_BEARER` internally;
the storage subprocess receives neither. Prefer credential environment variables
in workflows without forbidding user-selected CLI flags. The native `GH_REPO` selector must be
unset for independent checkout verification; keep explicit targets on mutations.
Owned Terraform names use `repo_name`, `repo_id` and cross-platform `gh_repo_id`;
provider attributes and existing resource addresses retain native spellings.
Project outputs use `module.gcp.project_id` / `project_number` and root
`gcp_project_id`; retain `tf_state` on bucket names. Operators select one
`GH_PLAN_REF` (`RUN_ID/ATTEMPT/GENERATION`); review derives its components internally
and Apply uses the same reference without replanning.

Tool wrappers use native discovery for Actionlint and Clang configuration.
Retained file selectors use `<TOOL>_CONFIG_FILE`, including
`EDITORCONFIG_CHECKER_CONFIG_FILE`, `GOLANGCI_LINT_CONFIG_FILE` and
`PREK_CONFIG_FILE`. The latter is shared by the Prek and keep-sorted adapters.
Keep explicit paths where wrappers validate settings or change working roots;
do not rename upstream-native configuration variables.

#decision [[factory-starters]]
Native `templates.default` supplies a downstream-only flake starter. It uses the
same modules with explicit tool/file selections and no deployment or Pi activation.
Enter once with `nix develop` to materialize native configuration, then review and
stage it before approving direnv. Package/workspace/Turbo configuration is seeded,
not overwritten: repositories own later scripts, dependencies, layout and outputs.
The new package-manifest seed derives its pnpm pin from the selected Nix package;
Factory's own pin is aligned to 12.9.0. Flake and pnpm locks are generated per repo.
The base tasks reference no unavailable Factory workspace package, and an empty
workspace graph is not evidence of application validation.
Plan/Apply templates offer Infrastructure and Application jobs. Consumers select
available layers through `github.workflows.layers`; `tf_layer` selects one job per
dispatch and is passed as `--tf-layer` to the repository-owned task/app. Factory
selects Infrastructure only. Repository mappings retain each root's existing backend
prefix; shared templates contain no directory or backend-prefix arguments.
Apply must select the same layer as its reviewed Plan. If Infrastructure changes
inputs used by Application, apply it first and create a new Application Plan.

## Retained implementation decisions and open issues

- Public repositories require all-external-contributor workflow approval. GitHub
  rejects that endpoint for private repositories, which omit the resource.
- GitHub modules default to a selected-action policy allowing Factory's
  cross-organization workflows and pinned bootstrap/cache actions. Consumers
  may replace the repository-level allowed patterns explicitly; keep SHA pinning
  enabled and do not rely on a repository's previous allowlist when migrating
  from allow-all.
- Keep pinned Semgrep pack coverage intact; a language directory is not equivalent
  to a curated pack. Cache redistribution/licensing review remains deferred.
- QMD uses external fetch builders to avoid the known builtin-fetcher route to
  Nix's fork-inherited mutex stall (NixOS/nix#16581). This is not a global fix;
  do not introduce a maintained Nix fork as a workaround.
- Taplo may lose asynchronous diagnostics on exit; tests assert validation
  semantics and exit status rather than unstable diagnostic text.
- Do not replace copied Semgrep rule directories with per-fixture links.
- Intentional nonports: terraform-docs, ESLint, a Gitignore snippet framework,
  scaffold/IDE/OS modules, old GitLab orchestration and the old CI cache image.

## Completed Factory infrastructure transitions

- Module-address split completed in run `39110692702`, retaining the existing
  bucket and `repository/prod`. Do not repeat it.
- Saved-plan/plan-reader rollout completed with Apply `39111226816`, receipt
  `12130102012`; normal private plan review replaced the temporary handoff.
- Storage audit rollout: source `99acec8`, Plan `39373527521`, receipt
  `12242591265`, approved Apply `39374387499`. All three log types were verified
  without exemptions. These are completed outcomes, not reusable approvals.
- Configuration namespace and owner-contract migration: source `5088c9c`, Plan
  `39919872065`, approved exact-generation Apply `39923368441`. Only module
  addresses and output names changed; cloud resources, IAM and backend identity
  were retained. Do not replay this completed migration.

## Native CLI packages

#decision [[factory-native-cli-packages]]
Amp and Hunk are selected directly from the locked `llm-agents` input; Tailscale
and ClickHouse directly from Nixpkgs. The four trivial alias modules are removed. `factory.clickhousectl.package`
packages the fixed-hash official release, retaining its Apache-2.0 license and
`chctl` alias. ClickStack management is `clickhousectl cloud clickstack`, not a
separate binary; native SQL access uses `clickhouse client` rather than ctl-managed
downloads. All four direct selections retain public packages with native tool
names and explicit Factory shell selection. The custom clickhousectl module retains
named/default module exports. Package exposure doesn't configure the services:
authentication, telemetry preferences, agent/review operations, databases, daemon
setup and tailnet/cloud changes remain operator-owned.

## Langfuse CLI

#decision [[factory-langfuse-cli]]
`factory.langfuse.package` is the opt-in module interface; `langfuse` is the
public per-system package and native executable, explicitly selected in Factory's
development shell. Package the fixed-hash official `@langfuse/cli` npm bundle with
locked `nodejs_24`, retaining the MIT license and bundled API contract assets.
The published bundle has no runtime npm dependencies. Native `LANGFUSE_*`
configuration remains runtime-only and operator-owned; do not import credentials
into Nix or manage user-global installations.


#decision [[factory-typescript-build-tooling]]
Use Vite for ordinary TypeScript app/package builds, Turbo for orchestration,
and TypeScript for checking. `rolldown-plugin-dts` supports the locked TypeScript
7 compiler; static-copy handles native local assets. Keep ordinary builds local
and offline: no upstream fetching or source refresh. The self-contained cold Nix
commands use pinned Node 24's native TypeScript support and do not require a
consumer workspace.

Herdr's Pi integration uses an independent pinned Git package in native settings.
The repository has no Pi manifest, so disable its conventional package resources
and explicitly select `./git/github.com/herdrdev/herdr/src/integration/assets/pi/herdr-agent-state.ts`
through the top-level `extensions` field. Pi installs the project Git package
before resolving that path. Ignore `.pi/git/`. No Nix-store paths, build-time
acquisition, local vendor tree, update script or native-binary version-sync check.
Downstreams may disable either integration independently; keep the corresponding
Git source when its explicit extension path is enabled.


<!-- 2026-10-24 04:01:40 [01a16d44] -->
#decision [[factory-module-composition]]
Keep Nix leaf implementations and named exports independent: each `flake.nix` named export points directly to its own module, without sibling imports or dependency bundles. Callers compose the modules required by the defaults they use; `nix/default.nix` remains the explicit aggregate convenience. Missing sibling options fail when their dependent defaults are evaluated, not merely on import; callers can replace those defaults through existing overridable options. Native TypeScript, Firebase and pnpm renderers consume the overridable `biome.formatFile` interface. Kubeconform targets an explicitly selected pinned schema version through `kubeconform.kubernetesVersion` or `-kubernetes-version`, never the kubectl client version. Cold Files and Semgrep commands independently load their stdlib-only package implementations with pinned Node 24's native TypeScript support, without bundling the combined workspace CLI or requiring node_modules.