# Factory project memory

Current source, tests and deployment skills take precedence over these notes.

## Memory policy

#preference [[factory-memory-publication]]
Keep only durable repository decisions, unresolved issues and deployment outcomes.
Do not retain machine-specific paths, credentials, environment details, temporary
files, session handoffs, routine check counts or investigation transcripts.
Reconcile unique publishable notes before removing duplicates. Commit sanitized
memory with related changes; do not create recurring note-only validation cycles.
Private consumer guidance belongs in the private repository, never here.

## Architecture and consumer conventions

#decision [[factory-config-layout]] [[factory-native-config]]
Factory is a shared Nix flake, not a shared shell-task framework. Use tool-owned
`nix/<tool>/default.nix` modules with meaningful colocated tests and native assets
under `etc/`. Every directory under `nix/`, including the root, has a `default.nix`.
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
in CI. Pnpm entry points live under `scripts/pnpm/`; every checked-in workflow
has a corresponding `scripts/github/` entry point. Protected Plan/Apply remain
workflow-only. `flake.nix` declares destination, source expression and seed/copy
mode through `nix/files/`. Direnv runs `factory-files write`: copy overwrites
like Devenv, seed keeps existing contents, and neither creates symlinks. All
selected destinations are checked-in regular files. Check requires them in the
Git index and compares copies with their source and index so entry cannot hide
committed drift. Q0 remains
Factory-independent.

#decision [[factory-shared-file-ownership]]
Native templates cover Gitignore, Husky pre-push, direnv, README seeds and explicit
license/notice selections. Keep the proprietary template named `PROPRIETARY`.
Consumers patch sources before `copy`; there is no separate patch mode. README
uses `seed` and remains repository-owned after creation; preserve its H1,
Prerequisites, Development and Skills presentation. Never infer a repository's
license or replace its third-party notices. Commit `.envrc` copies for bootstrap;
normal direnv approval remains required. Keep domain-specific deployment guidance
in consumer references and share only applicable entry points/procedures. Q0 stays
independent. QMD ownership is unchanged pending a separate copy-versus-seed decision.

#decision [[factory-declarative-flake]] [[factory-package-exports]]
Keep repository-level inputs, systems, public `packages`, `devShell.packages`
and `devShell.files` in `flake.nix`. Keep section interiors free of explanatory
comments and blank-line groupings. `lib.mkFlake` under `nix/flake/` handles only
module evaluation, platform iteration and output wiring; do not hide repository
policy in a shell module. `lib.mkFiles { inherit pkgs; }` accepts destination-to-source/mode
declarations; local paths and derivation references are retained without a caller
`sourceRoot` or manifest variable. Package-only modules are replaced by explicit
`packages.<system>.<name>` exports using upstream names, including `nodejs_24`.
Factory-owned workflow outputs use `github-workflow-plan` and `github-workflow-apply`.
Unsupported or broken exports are omitted for that platform. Factory enables
unfree packages in its own Nixpkgs instance; host configuration is unchanged.
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
validation. Declare runtime dependencies through pinned inputs/locks; never weaken
assertions or skip coverage to conceal missing dependencies.
Keep comments about current behavior, not historical migration narratives.
`AGENTS.md` stays a navigation index. README edits require explicit approval.

Checks are read-only; fixes and hook installation are explicit. Husky's tracked
pre-push entry point runs direnv checks and optional legacy handling before LFS
upload. No commit-time hook or implicit shell-entry installation is intended.

## Shared Pi extensions

#decision [[factory-pi-extensions]]
Use one first-party Pi extension with a small registration entry point at
`src/pi/extensions/factory/index.ts`. Keep its implementation flat, with
single-word filename stems and colocated tests; no internal subdirectories.
Only `index.ts` imports sibling implementation modules: it wires plain dependency
objects into consumer-owned interfaces. `pi.ts` owns Pi registration, sessions and
SDK UI integration; `git.ts` owns Git inspection and protections; `herdr.ts` owns
Herdr workspaces, agents and reconciliation; `terminal.ts` owns foreground process
execution and terminal restoration; `direnv.ts` owns worktree environment approval.
Keep these boundary implementations independent of the Pi SDK. No dependency-injection framework, service registry or interface per helper.
Tests inject boundary dependencies rather than mocking sibling modules, retaining
real Git repositories and Pi session files where their behavior matters.
Author code there, not in `etc/` or generated `.pi/` copies.
`factory.pi.extensionsDir` packages the Factory extension and the unmodified
Pi agent-state integration from the pinned Herdr package. Consumers explicitly
copy this directory to `.pi/extensions` and select Pi, Herdr, Git and shfmt in
their development shell. Shared Pi settings select pinned upstream memory,
web-access and Langfuse packages; Pi installs those npm packages after project
trust, not during the Nix build. Langfuse credentials and telemetry destinations
remain operator-managed and outside Git/Nix outputs. Factory owns the
foreground-terminal handoff tool alongside its worktree tools; hardware-cursor
customization remains personal. Shared integration covers Pi built-ins,
Factory-owned tools and declared dependencies, not personal extension collections.
Use foreground-terminal for requested interactive programs and ordinary Bash for
captured output. Do not add a tool wrapper for every CLI or a plugin framework.

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
Check is credential-free and never publishes caches. Credentialed main workflows
select the cache named after the caller's GitHub owner, configure authenticated
reads, and publish through the pinned Cachix action. Private derivations must
never be uploaded to a public cache. Cache credentials never enter source, state
or Nix outputs. Preserve signatures and repository/profile cache isolation.
Namespace caches are best-effort; a cache-action message does not prove a hit.
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

Plan/Apply remain manual, protected-main operations with original and triggering
actor checks, protected environments, WIF, backend locks and non-cancelling
concurrency. Workflow reuse is file-based: Factory maintains native YAML under
`etc/github/workflows/` and one Nix module with CI transport scripts at
`nix/github/workflows/default.nix`. Consumers other than independent Q0 materialize the
the files explicitly and own their task-specific input validation, release
logic and post-Apply checks. Do not add downstream-application-specific logic
to shared templates. For Terraform-only infrastructure, the shared workflow
scripts call OpenTofu directly and honor `TF_DIR` (default `tf/infrastructure`)
so single-root consumers can select `tf` without changing backend identity.
Deployment skills use the consumer's selected root. Local exceptional commands
live in deploy skills, not local Plan/Apply tasks. A merge or green Check is not deployment approval.
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
