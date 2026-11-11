# Factory project memory

#preference [[direct-main-updates]]
Prefer direct fast-forward pushes to `main`, not pull requests, unless explicitly
requested. Prepare changes in linked task checkouts and satisfy required checks,
signed commits and linear-history protections before pushing. Never disable or
bypass branch protections to follow this preference.

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

#decision [[package-names]]
JS/TS roots use `@org/repo`; apps and libraries use `@org/repo-package`.
CLI apps add `-cli`. Normalize `.github` to `github`, retaining interior dots.
Python distributions use `org-repo-package` with separator normalization;
imports use underscores. Keep published names aligned with this convention.

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
Python projects may pin Ruff and Pylint together in uv development dependencies,
with Nix supplying Python and uv. `ruff.configFile` and `pylint.configFile` expose
native defaults; existing optional Ruff Nix executables remain available. Pylint
is config-only and leaves import ordering to Ruff. No Python manifest starter or
generic TOML configuration merger is provided.
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
behavior in `packages/`. The apps are Nix, GitHub, Namespace, Amp, OTel and repo;
the packages are Nix, GitHub, Namespace, Amp, OTel and Pi. Code packages use `src/` with colocated tests and
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
native TURBO_CACHE/TURBO_TOKEN. Opt-in `turbo.shellHook` owns the `local:rw`
default and preserves caller-selected cache access; do not repeat that environment
default in package scripts. Order task declarations dev → check → fix → test → build.
Protected Plan/Apply remain workflow-only.
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
module imports alone do not activate it. Hooks stay tool-specific: consumers
explicitly compose `files.shellHook`, `pi.shellHook`, and optionally `uv.shellHook`
through their own `flake.devShell.shellHook`; there is no umbrella hook or
inherited Factory development shell. `uv.shellHook` pins the Python interpreter,
disables uv interpreter downloads, and adds the C++/zlib wheel runtime on Linux
while preserving existing library paths. Python dependencies remain explicitly
installed by the consumer. Compose file reconciliation before Pi memory setup.
These native shell hooks run for both direnv and `nix develop`;
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

#preference [[namespace-cache-command-names]]
Use `namespace:nixcache:proxy` for proxy setup and `namespace:nixcache:publish`
for publishing outputs. Keep cleanup internal; do not add GitHub cache aliases.

#preference [[factory-test-value]]
Use small behavioral regressions for Factory-owned boundaries. Avoid configuration
snapshots, tests of upstream behavior, unnecessary abstractions and repetitive
validation. Terraform policies retain permission and state-safety invariants, not
exact resource inventories or root module-expression wiring. Workflow tests
exercise input forwarding, failure handling and deployment gates without freezing
shell formatting or asserting the absence of historical variable names. Minimize
new files, directories and abstractions; add them only when required and list the
additions at task completion. Prefer inlining small shell glue in its owning Nix
module or native workflow rather than adding separate shell-script files. Declare
runtime dependencies
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
makes it explicit-use. Matt's selected engineering/productivity skills and his setup skill are
unchanged; running setup or installing anti-slop lint rules remains a separately
approved repository operation. Do not enable Superpowers bootstrap implicitly.
Upstream skill distributions retain their own licensing. Factory does not copy
or aggregate the upstream catalog. There is no Factory skill-patching or
vendoring framework.

The selected `grilling` and `domain-modeling` skills complete references from
`improve-codebase-architecture`; `prototype` and `writing-for-agents` add design
exploration and agent-instruction guidance. HumanLayer's
`narrow-react-prop-types` is selected for application prop cleanup: do not infer
that repository-local usages exhaust a published component library's contract.
Keep these upstream sources unchanged, including their host-specific invocation
wording. Skill selection does not install a Claude-style Skill tool or a generic
background-agent tool in Pi. TDD skills are intentionally not selected.

The catalog also selects React composition, Docker scaffolding/cleanup,
ClickHouse architecture, Python typing/async/profiling, TypeScript types,
Go style/errors/testing/gRPC, Resend API and Stripe docs/upgrade guidance.
Testing guidance is not a requirement to adopt test-first development. Apply
skills only to matching work; preserve project language versions, dependencies,
formatters, type checkers, service ownership and deployment workflows.
Upstream instructions to install tools, use the latest SDK/CLI, add a helper
library or upgrade an API are not authorization to change pinned toolchains.
Ask before such changes; retain Nix-owned runtimes and explicit dependency installs.
Do not copy examples that log signing secrets, email content or raw sensitive
payloads into agent output. Verify snippets against installed APIs and tooling.
Resend's separate `email-best-practices` remains excluded for flawed webhook and
timeout examples. Terraform's test/refactor candidates remain unselected pending
correctness and OpenTofu review; existing style guidance remains available.

`etc/pi/settings.json` is the only native settings template. Factory overrides
only its local package source when materializing `.pi/settings.json`.
Preserve the exact pinned upstream npm selections. SDK-only settings entries
do not activate resources; Factory bundles its declared SDK dependencies from
the workspace lock rather than searching Pi's installation directories.
Npm transitives installed independently by Pi do not inherit the workspace lock.

#decision [[factory-goal-and-mast-extensions]]
Native settings select `pi-goal-x@0.34.1` and commit-pinned
`dbreunig/pi-mast-steer` unchanged. Use Pi-native goals rather than adding Ralph's
Amp/Claude process loop. Goal creation is explicit; continuation is unlimited
unless configured. `pi.goalSettingsFile` provides native settings with
`maxAutonomousRuns: 10`; Factory seeds `.pi/pi-goal-x-settings.json` from it so
operators can tune the allowance through `/goal-settings` without reconciliation
overwriting their choice. Consumers must explicitly seed this optional asset.
The allowance resets on creation/resume; it is not a total token or cost cap.
The optional completion auditor defaults to an isolated resource loader with
Bash access: it does not inherit Factory guards and is not a read-only sandbox.
Use goals in task worktrees; extension-owned state writes are outside the
model-facing file-tool guards. Do not infer cross-worktree goal synchronization.

MAST checks transcript excerpts with TypeSafe Jev, including tool results but
excluding thinking and images. This is external transcript processing, not just
metadata telemetry. `TYPESAFE_API_KEY` remains operator-owned; unavailable checks
fail open. `/mast off` disables checks; `/mast shadow` still sends excerpts but
withholds steering notes. Notes are advisory, not completion gates or proof of
correctness. These package selections are not live end-to-end qualification.

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

The guard operates without Herdr and blocks direct primary-checkout file edits.
For Bash, foreground-terminal calls and Pi's user shell input, shfmt identifies
literal Git/gh calls and static directory changes; known primary mutations,
including switch/checkout and GitHub PR checkout, are blocked. Verified
`--ff-only` pull/merge syncs of main's configured remote main branch remain allowed;
Git rejects divergence and conflicting local edits without resetting or stashing.
Dynamic executables/targets, Git environment overrides, wrapper commands and
sourced scripts are outside this narrow check, not rejected merely because they
cannot be resolved. Never expand this into a general shell interpreter.
Primary branch drift still stops guarded mutations; never automatically switch
back, stash, reset or copy uncommitted files. PowerShell remains unsupported.
This prevents common accidents, not hostile execution: arbitrary scripts, other
tools, interactive input and external processes are not sandboxed. Read-only
tools remain available for diagnosing drift.

Global-to-project cutovers are operator-local migrations, not personal extension
paths or exclusions baked into shared settings. Remove global copies only after
the relevant repositories have adopted validated project-local replacements;
unrelated repositories must not lose integration silently. Herdr and Pi must be
available in the child pane's shell; a blocked startup/trust prompt is reported,
never automatically approved or bypassed.

## Dependencies, credentials and caches

#preference [[checked-direct-main]]
When repository protections permit, push checked task commits directly to main
rather than opening PRs. Preserve linked task checkouts, required checks and
fast-forward history; never bypass protections.

#decision [[factory-npm-distribution]]
Publish Factory Pi, GitHub and Namespace packages publicly through npm; the root
workspace and Nix package stay private. Package builds and staging run on Namespace,
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

#decision [[factory-namespace-nix-cache]]
The opt-in `nixcache` module packages fixed-hash official Namespace binaries;
`namespace-cli` is selected directly from Nixpkgs. Authentication, daemon setup
stay runtime-owned. Consumers explicitly select `nixcache.shellHook` with an
expected workspace and public key to manage local reader proxy startup; imports
alone do not start it. The hook skips CI, never prompts for login, preserves
existing caches/keys and refuses unmanaged listeners or mismatched workspaces.
Multi-user trust remains administrator-owned; an untrusted client may select
an administrator-allowlisted URL only when its public key is already trusted.
It never installs client-side signing trust. Cold evaluation precedes the hook.
Public Factory keeps Cachix. Consumers may select
`github.workflows.nixCache = "namespace"` for trusted-main workflows, export
`nixcache` and configure their own public trust. Check never starts a writer
proxy. Keep local authentication, workspace verification, proxy reuse and Nix
configuration inline in the shell hook; local startup does not require npm.
The Namespace TypeScript package owns CI proxy startup, signed publication and
cleanup only; do not duplicate local-shell behavior there. Install its published
release as an ordinary pinned app dependency, not a second Nix npm-artifact pin.
GitHub TypeScript commands for Test/Build/Plan/Apply wrap their existing tasks
with the Namespace API after dependency installation, publish only on success,
and always clean up. Each workflow uses one task step; setup does not require a
pre-install bootstrap helper or separate publication step. Use
`namespace:nixcache:proxy` and `namespace:nixcache:publish` for cache aliases.
The GitHub 0.1.3 publisher export remains available for compatibility, but is not
the Namespace integration boundary. Native subprocesses never receive the
private signing secret in their environment.
Namespace instance authentication is separate from native Nix signing:
only Namespace publication consumes the private signing secret, validates its public half
and removes the temporary key file. Publish restored paths too; volume reuse
does not establish remote publication. Namespace blobstorage permissions are
separate from main-only volume commits. No cache integration authorizes prod
dispatch, credential provisioning or a broader runner access level.

#decision [[factory-cachix-policy]]
Check receives no production provider credentials and never publishes remote caches.
Its Turbo reads use the organization cache credential with a client read-only
flag, not a server-enforced reader grant. Credentialed main workflows
select the cache named after the caller's GitHub owner, configure authenticated
reads, and publish through the pinned Cachix action. Private derivations must
never be uploaded to a public cache. Cache credentials never enter source, state
or Nix outputs. Preserve signatures and repository/profile cache isolation.
Namespace volume caches are best-effort; a cache-action message does not prove a hit.
Turbo persists .turbo/cache alongside /nix, with existing repository/profile volume
isolation and main-only snapshot publication. One remote Turbo team main is shared
within each caller workspace. Use one expiring, cache-only read/write TURBO_TOKEN
organization secret with GitHub visibility `all` for every current and future
repository in the matching organization. Never share tokens across workspaces
or shadow them with repository/environment copies. As with Cachix, authorized
workflow writers are trusted across the shared remote cache. Main-only publication is
workflow policy, not a secret-release boundary. Check keeps client remote:r;
trusted main Test/Build may use remote:rw. External/fork PRs receive no remote
token. Developers use user-bound server-scoped readers; client read-only flags
alone are not authorization. Existing prod/provider protections and platform
main-only volume publication remain unchanged. Credential changes require separate
approval and live verification. The current organization CI writer expires on
2027-02-03; replacing GitHub bindings does not revoke old Namespace tokens.
Restricted-runner authentication and real remote hits were verified with a scoped
reader; read-only uploads were denied. The temporary qualification writer was
revoked. The original 2026-10-25 setup installed CI readers and cache-only prod
writers with a 2027-01-23 expiry; those prod overrides are no longer used by CI.
On 2026-10-25, population run 40190329593 and verification run 40191374855 qualified
all four layers on quantile-4x8: Turbo local-only and remote-only hits,
changed-input misses, Nix store reuse with builds/substitutions disabled, and
signed Cachix imports into an empty isolated store. Early volume misses gave way
to actual cross-run reuse; snapshots remain best-effort and may be stale.
Restricted access, repository/profile isolation and main-only publication were
unchanged. Other profiles are not implicitly warm. Temporary diagnostics were
removed. The rejected separate-environment plans are obsolete and must never be applied. See the deployment configuration
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
Root seeds only dispatch tasks. A minimal repository-owned `apps/repo/` seed
performs managed-file check/write; consumers extend its checks and fixes instead
of embedding implementation in root scripts. Script task order is preserved
while injecting the pnpm pin. Generic repository bootstrap checks are not
application validation; add meaningful application/package tasks explicitly.
Plan/Apply templates offer Infrastructure and Application jobs. Consumers select
available layers through `github.workflows.layers`; `tf_layer` selects one job per
dispatch and is passed as `--tf-layer` to the repository-owned task/app. Factory
selects Infrastructure only. Repository mappings retain each root's existing backend
prefix; shared templates contain no directory or backend-prefix arguments.
Apply must select the same layer as its reviewed Plan. If Infrastructure changes
inputs used by Application, apply it first and create a new Application Plan.

## Namespace package release

#deployment [[namespace-npm-release]]
`@quantile-co/factory-namespace@0.1.0` is published after protected Build
`42781366409` qualified and staged source `effcabfe3d37d4c2941795f913c3997239bdc1d7`
and the maintainer completed npm approval. Registry SHA-1
`4fc0104675c0b793cb01945c570b20fb22a1278c` matches the staged artifact.
Consumers install the normal npm dependency; local shell startup stays inline
and independent of npm. Subsequent authorized consumer qualification established
live native signed publication and retrieval into a separate empty store with
public fallback disabled. The root verified against only the consumer signing
key; upstream closure dependencies retain approved public-cache signatures.

#deployment [[namespace-blob-cache-qualification]]
Raw blob access is distinct from Limited's `cache/*` API access. Restricted and
Limited workload credentials both failed blob authorization. A separately
approved Permissive profile supplied workspace-default `blobs/*` grants and
qualified the released lifecycle without a new stored authentication token.
This authority is broader than cache-only access: obtain explicit approval,
preserve full profile specs and verify API readback; never silently relax other
workspaces. The tested `blobs` revokable token was rejected; Custom grants also
failed with the observed `exists`, `read`, `create` actions on `nix-cache`.
Do not infer grant acceptance from schema fields or conceptual action names.
The older pinned CLI lacks Custom fields and discards unknown fields/enum names;
use a compatible client and full API readback for approved custom experiments.

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

## Factory 0.1.3 publication

#deployment [[factory-nix-cache-publication]]
Both public Factory packages were published at 0.1.3 after protected Build
`42767105872` qualified and staged source
`0298f837f0600f072f4c34f5935e4001c2a86b16` and the maintainer completed npm
approval. Registry tarball SHA-1 values match the staged Build output:
GitHub `7eea138f5608b22d149c8e4693fc23fba4154726`,
Pi `05480110df043b7ea54c9f91043c079939f74efc`.
The GitHub artifact exports `publishNixCache`; Pi includes the updated cache
deployment guidance. This publication did not dispatch infrastructure Plan/Apply
or qualify any consumer's private-cache publication/reuse.

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

<!-- 2026-11-10 18:21:15 [01a1c824] -->
#decision [[factory-amp-orb-pilot]]
Amp integration lives in `packages/amp` with a thin `apps/amp` Commander CLI
(`pnpm amp`). Keep this an adapter to native Amp, Tailscale and Herdr surfaces:
no webhook receiver, scheduler, task database, automatic prompts or transcript
synchronization. Native Amp issue-only spawners remain separate operator setup.
Factory now has one enabled, unblocked, user-owned native spawner for newly
opened `quantile-co/factory` issues with the exact label `factory-automatic`, targeting the
Factory workspace project in Medium mode. Its saved instructions permit only
read-only issue triage and bootstrap diagnostics, then wait for the operator;
no automatic code changes, deployments, Pi prompts or keep-awake. There is no PR
or installation-wide trigger. The label must be present when the issue opens;
adding it later does not trigger a run. The separately approved 2026-11-11 test
issue #56 generated exactly one delivered run and thread
`T-8fb40ff3-58d7-49d4-8f11-1ad556b28962` in the expected Factory project/Medium
mode. Setup and resume completed on clean `main` at `e306ed2`; both services were
active without restarts. Authenticated orb diagnostics supplied the new host key,
then independent strictly pinned SSH verified service/Herdr readiness and the
expected Auto plugin hash. Herdr had no Pi agents, no Pi auth file was present,
and the plugin acquired no lease. Its initial unavailable-activity message
preceded Herdr startup; it did not prevent bootstrap. Tailscale reported sandbox
iptables/UDP health warnings, but relay-backed SSH succeeded; no network policy
was changed to suppress them.

Only the test thread was archived and issue #56 closed after verification;
readback confirmed archival, issue closure and the test tailnet node offline.
Local temporary SSH trust files were removed; no saved Herdr profile was added. The
interactive pilot and two earlier failed pilots were untouched. That single-test
approval is consumed: further billed test orbs require fresh approval. This
qualifies the native read-only issue-delivery path, not automatic implementation,
all provider ingress paths, downstream rollout or Terraform label state adoption.
The first pilot is Factory's own executable `.agents/setup` / `.agents/resume`;
do not roll hooks out to consumers before one-orb qualification.

Setup enters the locked Nix shell, installs frozen workspace dependencies and
builds the packages. The shared setup requires explicitly installed tools,
prepares dormant dedicated systemd services, provisions the OpenSSH privilege-
separation account when absent, and refuses activated runtime state. It preserves
different user-owned `~/.local/bin/herdr` / `pi` entries; new entries reference
the selected binaries, with Nix GC roots for store-backed executables. No shell
profile replacement or downloaded Herdr fallback is intended. The first live
pilot completed dependency installation/build but stopped before service creation:
Debian's `useradd`/`nologin` existed under `/usr/sbin`, outside the orb user's PATH.
Setup now appends native sbin directories after the pinned tool paths and requires
account-creation tools only when `sshd` is absent. Focused mocked execution covers
both account states without privileged host changes. A partial resume can leave
`~/.local/state/factory-amp/thread` even when enrollment fails; do not clear that
marker or bypass the activated-state guard to retry setup without explicit
recovery approval. The next pilot verified setup, Tailscale enrollment and Herdr
startup, but its dedicated sshd collided with Amp's wildcard port-22 listener.
The old simple systemd unit let resume print Ready before that bind failure.
Fresh-orb verification of `9bd349c` subsequently confirmed setup, notify-ready
sshd, Tailscale Serve, approved-key SSH and the native Herdr `orb` session API.
The workstation pinned the host key against authenticated orb diagnostics before
login. Earlier failed pilots were left untouched; their Ready messages are not
SSH successes.

Runtime requires the approved workspace's nonsecret `TAILSCALE_CLIENT_ID` and
`TAILSCALE_AUDIENCE`. The pilot also requires `FACTORY_AMP_SSH_PUBLIC_KEYS`
containing the explicitly approved public authorized keys, never private keys.
Resume obtains thread metadata from its runtime Amp token and enrolls with
`--subject-scope workspace`, using ephemeral/preauthorized `tag:amp-orb` nodes.
Preauthorization intentionally skips device approval; change that explicitly if
the tailnet requires approval. Tailscale verifies identity; local JWT decoding is
only naming metadata. Credentials never belong in setup snapshots.

The dedicated tailscaled uses `/run/factory-amp/tailscaled.sock`; ordinary local
discovery uses the workstation's daemon. Factory sshd binds only to
`127.0.0.1:2222`; native `tailscale serve --bg --tcp=22 tcp://127.0.0.1:2222`
exposes it on the tailnet without colliding with Amp's built-in sshd or changing
the external port/grant. This is Serve, not public Funnel. The pinned OpenSSH
supports systemd readiness notification; `Type=notify` and a bounded startup
timeout prevent a successful restart from being reported before the listener
binds. SSH uses per-orb runtime host keys and public-key authentication, disabling
passwords, SSH forwarding and root login. Existing host daemon settings are not
replaced. E2B's envd automatically bridges the loopback port to its host-side
interface, so loopback binding is not proof of exclusive tailnet reachability.
An external check of the pilot's documented E2B HTTPS endpoint for port 2222
returned 403 with the matching sandbox ID and an explicit missing traffic-token
error; an invalid token was also rejected. Plain HTTP reset the connection. No
public Amp portal was configured. This verifies token-protected provider ingress
for that pilot, not exclusive tailnet reachability or a guarantee for every future
orb. Retain SSH key authentication; provider-authorized access remains separate.
Herdr runs as the orb user in named session `orb`, inheriting the runtime
environment. Browser/mobile Terminal attach command:
`~/.local/bin/herdr --session orb`; start Pi in its repository pane with
`nix develop --command pi`. Pi's own provider login/keys must be supplied at
runtime, not cloned from a shared image. Reauthentication/environment changes
and session restoration still need real sleep/wake qualification.

Only `AMP_ORB=1` together with an exact canonical `FACTORY_AMP_REPOSITORY`
allows Pi to edit the disposable primary checkout directly. Other repositories
retain normal main/worktree guards, and direct Git-metadata edits remain blocked.
This is an accidental-action policy, not a sandbox or proof of workload identity.

`pnpm amp list` reports native Amp thread results, tagged Tailscale peers and
saved Herdr profiles without inventing a cross-service registry. Explicit
`connect --thread T-… --repo org/repo [--issue N] [--title text]` selects the
unique online thread-named node and delegates profile creation to native
`herdr machine add`. Labels start with org/repo, or a project name for non-GitHub
work, and include a short thread suffix. The full thread UUID determines the
hostname. Existing profiles are never replaced or automatically enabled.
SSH cannot wake paused orbs; open the thread in Amp first. Inspect changed host
keys, name collisions and stale profiles rather than bypassing SSH checks.

`packages/amp/src/plugin.ts` builds to standalone `dist/plugin.js`, using only
Node built-ins (no package imports). Factory's orb setup installs it as the per-orb system
plugin `${XDG_CONFIG_HOME:-$HOME/.config}/amp/plugins/factory-orb-awake.js` after
successful dormant setup. No workstation, personal or workspace-global plugin is
installed. Factory source remains canonical; do not assume remote npm imports
work. Keep-awake now defaults to Auto inside an orb: sample native Herdr Pi
activity in session `orb` every five seconds, hold while working, then release
after two minutes without observed work (including blocked/exited agents or
unavailable status). Do not cap working time: long-running agents must retain
their lease for as long as Pi reports work. Native palette commands select Auto,
On (explicit indefinite hold), or Off. Reload returns to Auto; process exit
releases Amp's lease. Monitoring invokes the local Herdr CLI directly, not Amp
shell/tools that could refresh its idle clock. It does not start Herdr, wake a
paused orb or synchronize transcripts. Leases are billed and best effort, not a
guarantee against manual pauses or provider limits. Focused tests cover state,
grace, long-running work, failure and override behavior. The first live Auto load
exposed an incorrect executor guard: native `PluginExecutor.kind` is `local |
remote | unknown`, describing UI location, not an `orb` discriminator. Use
`AMP_ORB=1` for the local runtime guard; native `keepAlive()` remains authoritative
and rejects non-orb callers. An `active` plugin with no registered commands was
inert, not a successful keep-awake test. Tests must use the actual native enum.

The corrected build at `53ed7c4` passed 15 focused tests and required CI, then was
hash-verified and loaded on the existing pilot on 2026-11-11. Native loading
registered all three commands. A genuine Pi model/tool turn in the preserved
session produced observed working/idle transitions; plugin logs recorded Auto
acquisition at 06:23:50 UTC and release at 06:26:09 after the idle grace. The same
Pi session and model login worked after the disconnect/reconnect. This verifies
live activity-to-lease behavior, not normal provider idle pausing, which remains
pending. The user subsequently confirmed the shared Amp Terminal/Herdr/Pi view
works but found its UI clunky; device-specific mobile keyboard behavior remains
unqualified. Manual palette overrides and missing activity are unit-tested, not
yet live-qualified. Actual plugin logs are JSON
`Plugin stderr` entries in `~/.cache/amp/logs/headless.log`, with text in `stderr`;
exclude tool transcripts quoting source. Transfer and rollback scratch under
`/tmp/factory-awake-stage/` was removed after activation. The per-orb plugin remains
in Auto; no persistent manual hold was enabled.

The initial pilot installs the three runtime values as Factory project-level
environment variables, not workspace/personal overrides. Only an explicitly
approved public SSH key is included. No issue spawner, keep-awake lease, Pi login
or saved Herdr machine is configured by those environment settings.

With the pinned Amp CLI, `amp threads new --executor orb` creates an empty local
placeholder, not a running orb. Native `amp -ox <prompt> --project org/repo`
starts the orb; the first prompt is required. Use an explicit read-only diagnostic
request for a pilot, not an automated prompt from the lifecycle hooks. A thread
URL or VM metrics alone does not establish successful setup/enrollment;
`amp top --stream-jsonl` exposes executor connection state. Hook failures still
require their setup/resume logs before recovery, not a duplicate orb launch.

Bootstrap, enrollment and SSH have fresh-orb verification; the full interactive
session workflow remains unqualified. Still verify
workspace identity/trust and administrative credential permissions, native plugin
installation, SSH account/host-key behavior, mobile terminal keys, model login,
pause/resume/reconnect and issue spawners before adoption/publication. No automatic
npm release-pipeline expansion is included in the pilot.

## Managed Observability agents

#decision [[factory-managed-observability]]
Factory agents export directly from existing Amp orbs and Namespace runners to
ClickHouse Observability; no central collector/server is deployed. Native
`otelcol-contrib.package`, `hostConfigFile` and `dockerConfigFile` expose only the
locked upstream binary and YAML under `etc/otelcol-contrib`. The locked 0.155.0
binary supports `host_metrics`, `docker_stats` and `otlp_http`; revalidate upgrades.
There is no Factory Nix launcher. Explicit caller shell selections supply absolute
`OTEL_COLLECTOR_BINARY`, `OTEL_COLLECTOR_CONFIG` and `OTEL_COLLECTOR_DOCKER_CONFIG`
paths. Imports and shell entry start nothing.

`packages/otel` owns the reusable `@quantile-co/factory-otel` package: `config`
validates managed configuration, `collector` owns bounded process lifecycle,
`otlp` exports small metadata batches with Node built-ins, and `tracing` initializes
standard Node OTel with the official HTTP exporter. `apps/otel/cli.ts` is thin;
root `pnpm otel -- <command>` and the packed `factory-otel` bin need no consumer
copy of Factory source. `factory-otel collector` is the foreground agent mode.
`@quantile-co/factory-otel@0.1.0` is public after protected Build `42985831089`
from `873e8f49bb4086938cbfab9ee9eaf1664f47a8dd` and maintainer 2FA approval.
Registry tarball SHA-1 `23c05774754f7c9df00b166e57bf1efe17628c96` matches staging.
Future publication remains separately approved. Build offers an explicit OTel
package group; consumers pin published versions and lockfile integrity.
Packed-consumer smoke installs prefer cached packages but allow registry metadata
fetches: a clean frozen workspace install does not populate pnpm's metadata cache.
Namespace retains cache/platform ownership; Amp retains event/orb integration.

Runtime-only vendor names remain `CLICKSTACK_OTLP_ENDPOINT` (HTTPS origin, optional
trailing slash; no signal path, userinfo, query or fragment) and
`CLICKSTACK_API_KEY` (raw key, sent as `Authorization: Bearer …`). Both absent
means disabled; invalid/partial configuration yields sanitized rejection. Never
put values in Nix, source, cache inputs, shared snapshots or logs. Host metrics
cover CPU, memory, disk/filesystem and network, with a generated service instance
and bounded `OTEL_AGENT_*` identity supplied by platform owners. No ambient OTel
resource attributes, process scraper, logs or arbitrary container/environment
labels. `OTEL_DOCKER_STATS=1` explicitly adds Docker stats; socket access is
effectively host-root authority and is never granted by default.

`github.workflows.otelJobs` defaults empty; Factory selects only manual Test.
Protected main/environment/All gates remain; Check/PRs never receive ingestion
keys. Frozen installation and secret-free Nix/shell evaluation precede `pnpm otel`.
The additional direnv export excludes the Namespace signing key too; it remains
available only to the subsequent task’s existing cache-publication lifecycle.
The wrapper strips ingestion credentials from workload/cache subprocesses,
preserves workload status and emits only task duration/outcome and allowlisted
identity, never commands, arguments, stdout, plan data or raw errors.

Amp setup installs the complete nonsecret CLI distribution and copies native
configs into orb-owned storage, rooting pinned Node/collector binaries against GC.
The dormant systemd service reads a private volatile `/run` environment file on
resume; it is removed after loading. Standalone Amp plugins inline only shared
builtins-only helpers, not the tracing SDK. Awake behavior stays separate; OTel
never acquires a lease, starts an orb or wakes one. Native agent/tool spans exclude
content/arguments/results/raw errors. Optional actual message usage is deduplicated
in bounded process memory; the pinned public API omits it, so none is estimated.

Application `initializeTracing` exports nothing without explicit caller-owned
sampling, constant span name and attribute privacy policy. Fresh allowlisted
spans precede batching; raw names/status messages/events/links/scope/resources
are discarded. No automatic instrumentation, resource discovery or ambient
exporter selection. Ambiguous ambient OTLP headers fail closed without changing
process environment; explicit native HTTP agent options avoid borrowing client
certificates. Initialization is idempotent and refuses an occupied global provider
or context manager. Langfuse/Pi remains separate and unchanged. Website-specific
policy and adoption belong to the owning repository. Delivery, acknowledgements,
retries and flushes stay bounded and best-effort, not durable billing accounting.

## Tailscale SSH transition (live qualification pending)

#decision [[amp-tailscale-ssh]]
The user approved implementing Tailscale SSH only; model login, API credentials,
Aperture and subscription federation are deferred. Keep per-orb Pi login unchanged.

New snapshots prepare only the dedicated tailscaled service and existing Herdr/
optional telemetry components. Resume enables native Tailscale SSH; there is no
Factory sshd, TCP Serve listener or authorized-key input. Setup requires stable
Tailscale >= 1.104.4. The separate locked `tailscale-nixpkgs` input selects 1.104.5
and its upstream dependencies without updating unrelated shell packages; retire
this extra input when the main Nixpkgs pin supplies the required version.
`TS_SSH_DISABLE_FORWARDING=1` disables port, Unix-socket and agent forwarding.
Systemd hides the three system SSH private-key paths only inside this service's
namespace so native Tailscale generates dedicated keys in its runtime state
directory instead of reusing Amp's keys. No host identity is generated in setup.

`amp connect` requires a unique online tagged peer and public `sshHostKeys`
from the authenticated local Tailscale daemon. It validates those public keys,
pins them in native `~/.ssh/known_hosts`, then verifies a fresh strict,
noninteractive SSH connection before native Herdr setup. No key scan, custom
broker, background discovery or SSH verification bypass. Matching hashed entries
are reused; changed keys and trust-marker entries fail without replacement.
A custom SSH configuration must consult that native known-hosts file; the strict
preflight fails rather than bypassing it. A recreated orb/key requires explicit
identity review and operator reconciliation. Node identity is authenticated by
Tailscale; a self-advertised hostname is not an independent Amp thread attestation.

Setup and resume reject existing Factory sshd units rather than migrating active
pilots. Existing pilots, sessions, login, local profiles and approved keys have
not been changed. The matching centrally managed SSH policy is now approved and
deployed: `autogroup:member` may reach `tag:amp-orb` as Unix `user`, using
`accept`. Access follows tailnet membership, not a hardcoded operator or separate
GitHub/GCP rosters; shared sessions are not per-user isolation. This clears the
policy prerequisite for publishing Factory's new lifecycle. The rollout preserves
the separately landed shared OTel runtime and snapshot safeguards. A new billed
qualification orb still needs separate approval. Source tests do not qualify
live SSH, systemd namespace isolation or pause/reconnect.

#deployment [[amp-native-ssh-snapshot-blocker]]
Native SSH source `d15139e` passed staging Check and was published to main.
The separately approved single Medium test on 2026-11-11 created
`T-1db3458f-7590-4b2e-993d-d86588769d60` at that clean source. All build tasks
passed, but setup correctly refused the inherited `factory-amp-sshd.service`:
`Legacy orb: do not migrate an existing SSH service in place.` Read-only orb
diagnostics found the old SSH/tailscaled units inactive, with no Tailscale state,
thread activation marker or Pi auth file. No native SSH/Herdr connection was
qualified, and no repair, rerun, migration or additional orb was attempted.
The test thread was archived; readback found it only in the archived list, no
matching tailnet peer, and no added Herdr profile or local host trust. Existing
pilots and model credentials remain untouched. This test approval is consumed.

[Amp's lifecycle](https://ampcode.com/docs/orbs/customizing#the-orb-lifecycle)
refreshes stale snapshots by rerunning setup over the old filesystem, not a
clean base. A new thread alone therefore does not remove a legacy unit. Before
another native SSH test, obtain approval to delete only Factory's cached
`a1.medium` project snapshot using native `amp projects snapshots delete` with
that explicit resource, then separately approve one new billed orb. Do not
remove active orb services, weaken the guard or delete every project snapshot.
The operator subsequently approved that exact cache deletion and one replacement
Medium orb. Native deletion returned success and empty snapshot-list readback.
Replacement `T-01a1c9c2-56d3-73e5-ba4b-d6610d542ec9` used clean `d4d4cf1` but hit
Amp's 20-minute setup timeout before pnpm or Factory setup ran. It was archived
after read-only diagnosis; archived-list readback succeeded and no matching
Tailscale peer or new Herdr profile/trust existed. No hook retry, repair, model
login or credential change occurred. Both approvals are consumed.

#bug [[amp-cold-nix-cache-bootstrap]]
The clean-base test exposed an existing hook bootstrap mismatch: `.agents/setup`
calls `nix develop` directly and `.agents/resume` calls `nix print-dev-env`, so
neither loads `.envrc`'s public signed caches. The fresh orb reported a trusted
local Nix store, signatures required, only `cache.nixos.org`, and `max-jobs=1`.
Exact pinned Herdr/Pi outputs returned 404 there and 200 on the configured
Numtide/Quantile caches. Independent workstation lookup confirmed the pinned
Herdr result. Setup downloaded the source-build toolchains and timed out before
entering its shell command; automatic resume then compiled Herdr from source.
The cause of setup's approximately 18-minute silent interval is not established;
no download error was reported. This is not evidence of an SSH policy failure:
no Factory services or Herdr session were installed, and no Pi auth file existed.
Both hooks now source `.agents/nix-env` before Nix evaluation. This small,
repository-owned bootstrap matches `.envrc`'s existing public caches and keys;
the focused test executes both hooks and checks parity with the native template
for trusted, untrusted, unknown and failed store discovery. No user-global Nix
settings, direnv approval or Pi/Herdr trust is changed. Runtime telemetry values
remain excluded from Nix and are restored only for resume. Signatures and
administrator-controlled cache selection for untrusted stores are preserved.
Native Nix signature verification accepted the pinned Herdr and Pi cache metadata
from Numtide with the existing public keys; payload import/timing is not implied.
Do not move heavy installation into resume or use warm snapshots to hide the
cold-path failure. Local checks are not live cold-orb qualification; another
billed test needs fresh approval.

#deployment [[amp-native-ssh-first-connection]]
The separately approved single Medium test `T-768260de-450a-40d2-a867-119f83b9de91`
used clean `60d3e71`. A cached Medium snapshot existed, so this was not a fresh
cold-start timing test. Setup reached the completed build in roughly 16 seconds,
then failed overwriting a 0444 inherited OTel `host.yaml`. Automatic resume
nevertheless enrolled the dedicated native SSH server and started Herdr.
Read-only checks found tailscaled 1.104.5 active with zero restarts, no legacy
Factory sshd, the configured system-key masks and forwarding-disable flag,
one Herdr workspace, zero agents and no Pi auth file.

The workstation's authenticated peer JSON advertised `sshHostKeys`: the Go
field is `SSH_HostKeys`, but its JSON spelling is camel-case. The original
connector and mock incorrectly used the Go spelling. An explicit diagnostic
used the correct field with the existing pinning helper and a temporary
known-hosts file. Fresh strict SSH succeeded as `user`, and native Herdr
workspace/agent queries succeeded over that SSH connection. This proves one
native SSH/server-API connection, not the original connector, saved-profile/TUI
attachment, cold bootstrap, key-rotation or pause/wake qualification.

The test was archived and confirmed absent from normal/present in archived
thread listings. Temporary trust was removed; no profile was added and the
existing pilot/profile/credentials were untouched. Approval is consumed.
Source now uses the real JSON field and native `install -m 0644` for the two
nonsecret collector configs, so refresh can replace read-only snapshot copies.
Focused regressions cover the observed peer schema and inherited 0444 configs.
No live repair or hook rerun was performed. Another billed test requires fresh
approval; do not report these source fixes as a successful end-to-end bootstrap.

#deployment [[amp-native-ssh-connector-qualified]]
The separately approved Medium test `T-ab070b8f-2752-4019-a464-714b7f688ec0`
used clean `f3be934` from a prepared project snapshot, not a cold base. Its
snapshot contained completed setup/plugin installation and 0644 collector
configs. Resume completed in about 73 seconds; dedicated tailscaled was active
with zero restarts, no legacy Factory sshd and no Pi auth file. Herdr reported
one workspace and zero agents.

The published `amp connect` succeeded without a manual key handoff or code
workaround: authenticated host-key pinning, fresh strict SSH and native Herdr
machine creation all completed. Native machine status reported reachable, with
no error. No installation replacement or repository-trust approval was needed.
This qualifies the saved-profile connector on that snapshot, not cold-start
performance, an operator-viewed TUI/model turn or automatic pause/wake behavior.

The thread was archived and verified absent from normal/present in archived
listings. Only the temporary test profile and its three new known-hosts records
were removed; the original pilot/profile/login were preserved. The immediate
post-archive peer read still showed online, so do not claim an independently
confirmed offline transition. No retry, additional orb or infrastructure phase
was run; the test approval is consumed.

#deployment [[amp-cold-lifecycle-qualification-in-progress]]
The operator approved deleting only Factory's cached `a1.medium` snapshot and
one new Medium orb for cold-start, UI and pause/wake qualification. Deletion
returned success and an empty snapshot list. Test thread
`T-01a1ccc9-3f21-723c-9e74-3fdc0d0273b0` runs clean `f3be934`. Cold setup completed
in about 71 seconds (12 builds, none cached); Nix copied from Numtide, Quantile
and NixOS caches. Resume completed in about 16 seconds. Native tailscaled is
active with zero restarts; no legacy Factory sshd or Pi auth file exists, and
collector configs are 0644. Herdr has one workspace and zero agents. The plugin
registered Auto with no lease events; its initial unavailable-activity message
preceded Herdr readiness. A provider redactor 401 warning did not fail setup.

Published `amp connect` succeeded and saved temporary profile
`2617ae64c3ef33247a7971243b3fdf1d`, labelled
`quantile-co/factory · Lifecycle test · T-0d0273b0`, session `orb`.
Operator UI and native Auto/On/Off confirmation are pending, followed by the
approved idle pause/wake test. No manual hold, Pi login or model prompt was
started. This test is intentionally not archived yet; finish the approved checks
or stop safely, then archive only this thread and remove only its test profile
and newly pinned hostname records. Preserve the original pilot/profile/login.
Do not launch a replacement orb or delete another snapshot under this approval.

## Downstream Amp adoption

The lifecycle/connection library and plugin in `packages/amp` are source-reusable;
the adapter is not yet published as a qualified downstream npm release. Consumers
must supply their own thin setup/resume hooks, pinned tools/dependency build,
repository identity and explicit disposable checkout path. Factory's `.agents/`
hooks are its pilot wiring, not generic files to copy unchanged.

Shared workspace federation avoids per-repository Tailscale identity registration,
but each Amp project still needs approved runtime enrollment values. New Tailscale
SSH orbs use the centrally approved SSH policy instead of project SSH public keys;
legacy OpenSSH pilots retain their existing keys and profiles. Native project mapping and issue spawners remain per-repository operator
configuration; neither a label nor a Terraform module creates an Amp spawner.
Pi/model credentials remain per-user runtime data. Herdr profiles remain explicit
workstation choices; no automatic sidebar population is introduced.

`tf/modules/project/github` supports a `labels` map and defaults
`factory_automatic_label = true` so repositories receive the shared
`factory-automatic` preset. Label existence alone does not enable a spawner.
Caller labels can override the preset. Singular `github_issue_label` resources
leave unrelated labels alone; existing labels need explicit import. The pinned
provider's Create implementation calls CreateLabel directly despite its docs'
upsert claim. Factory declares the preset and an import for its renamed pilot
label; protected Terraform state adoption still requires a fresh reviewed Plan
and separately approved Apply. No infrastructure Apply has been performed for
this change. Existing repositories receive the default on their next approved
module update/deployment; repositories outside this module need separate adoption.
No blanket cross-repository Apply is authorized by the default change.

#decision [[moshi-not-adopted]]
The user dropped Moshi after reviewing per-orb connection friction. Do not install
Moshi hooks, authorize the proposed phone key, enable SSH forwarding, or pursue
Moshi pairing/connection automation. No such runtime changes were made. Continue
the Amp/Herdr/Pi pilot; this does not authorize deleting or replacing existing
pilots or reverting unrelated shared infrastructure.

#decision [[amp-orb-qualification-order]]
Activity-driven lease acquisition/release, the shared Amp-terminal/Herdr Pi
session and one issue-spawner delivery are qualified on the earlier lifecycle.
The native SSH lifecycle and central policy are published. Qualify the cache
bootstrap fix and native SSH/host-key/Herdr on a separately approved new orb.
Finish automatic idle pause, wake/reconnect and operator Auto/On/Off qualification;
then reviewed Terraform label adoption, downstream packaging/adoption and final
artifact/worktree accounting. Model-login changes are deferred, not a rollout
prerequisite. A test issue/new billed orb and each protected Plan/Apply still
require their own approval.

#todo [[amp-orb-login-friction]]
- Keep Pi/model authentication unchanged. Investigation is complete for this
  rollout; API credentials, gateways, subscription federation and credential reuse
  are deferred. Credentials must stay out of source and shared snapshots.
- Qualify the implemented authenticated Tailscale host-key discovery and native
  SSH/Herdr connection on a separately approved new orb. Preserve strict trust
  across reconnects; recreated nodes or changed keys require explicit review,
  never blind acceptance or disabling host-key checks.
- Clean up completed task worktrees after checking for uncommitted work, unmerged
  commits and active agents. Preserve ongoing work; do not force-remove checkouts.
- At completion, account for every added file and directory, separating tracked
  source additions from modifications/deletions, unrelated upstream work, and
  ignored/generated or runtime artifacts (including local and orb configuration).
  Identify temporary artifacts that were removed and any remaining cleanup.