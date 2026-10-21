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
Factory is a shared Nix flake, not a shared Devenv configuration. Use tool-owned
`nix/<tool>/default.nix` modules with meaningful colocated tests and native assets
under `etc/`. Module imports do not install tools/hooks or execute tasks.
Consumers select packages, native configuration and task orchestration explicitly.
Keep configuration native rather than inventing Nix settings registries or tool
bundles. Reusable executables read consumer configuration at runtime and remain
independent of Devenv and CI. Keep Terraform native under `tf/`.

#preference [[factory-consumer-migrations]]
Keep migrations minimal and aligned with public quantile.co. Consumers extend
small `nix/` modules rather than adding an `etc/` directory. Order applicable tasks
install → check → fix → test → build → plan → apply. Keep descriptions brief and
intent-focused; reserve comments for non-obvious safety rationale. Project
descriptions match the GitHub description and README byline.
Use existing modules and workflows as-is rather than preserving obsolete policies.
Remove migration scaffolding after successful adoption and prove convergence.

#preference [[factory-test-value]]
Use small behavioral regressions for Factory-owned boundaries. Avoid configuration
snapshots, tests of upstream behavior, unnecessary abstractions and repetitive
validation. Declare runtime dependencies through pinned inputs/locks; never weaken
assertions or skip coverage to conceal missing dependencies.
Keep comments about current behavior, not historical migration narratives.
`AGENTS.md` stays a navigation index. README edits require explicit approval.

Checks are read-only; fixes and hook installation are explicit. Git's checked
pre-push entry point runs checks and optional legacy handling before LFS upload.
Installation uses the common Git hooks directory so linked worktrees inherit it;
no commit-time hook or implicit shell-entry installation is intended.

## Dependencies, credentials and caches

#decision [[factory-moving-flake-refs]]
Keep flake and Devenv locks aligned, including committed/indexed data. Dependabot
does not update `devenv.lock` automatically. Generated Dependabot configuration
must be a committed native file, not an ignored link. Consumers pin reviewed
Factory revisions consistently across tools, workflows and Terraform modules.

#security [[factory-production-flake-source]] [[factory-secretspec]]
Use Git-aware flake references, never `path:.` for a checkout containing runtime
credentials or infrastructure data. SecretSpec resolves values only at runtime,
not during Nix evaluation. Bare task invocation does not run `enterShell`;
credentialed workflows enter the shell and reject empty required values.
Forward named secrets explicitly; do not use `secrets: inherit`.

#decision [[factory-cachix-policy]]
Check is credential-free and never publishes caches. Credentialed main workflows
select the cache named after the caller's GitHub owner, configure authenticated
reads, and publish through the pinned Cachix action. Private derivations must
never be uploaded to a public cache. Cache credentials never enter source, state
or Nix outputs. Preserve signatures and repository/profile cache isolation.
Namespace caches are best-effort; a cache-action message does not prove a hit.
Do not dispatch production workflows just to warm caches. Keep public cache
additions in workflow `NIX_CONFIG`: Cachix's user-level configuration otherwise
overrides the installer's system-level additions. Preserve authenticated caller
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
files with Devenv `files` and own their task-specific input validation, release
logic and post-Apply checks. Do not add downstream-application-specific logic
to shared templates. Devenv plan/apply tasks remain useful outside GitHub. A merge or green Check is not deployment approval. Plan writes a
local saved file and private log; workflows use `gcloud storage cp` to persist
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
- Selected-action policies explicitly allow Factory's cross-organization workflow
  calls and pinned bootstrap/cache actions. Keep SHA pinning enabled; do not rely
  on a repository's previous allowlist when migrating from allow-all.
- Keep pinned Semgrep pack coverage intact; a language directory is not equivalent
  to a curated pack. Cache redistribution/licensing review remains deferred.
- QMD uses external fetch builders to avoid the known builtin-fetcher route to
  Nix's fork-inherited mutex stall (NixOS/nix#16581). This is not a global fix;
  do not introduce a maintained Nix fork or assume a standalone CLI update fixes
  Devenv's embedded library.
- Taplo may lose asynchronous diagnostics on exit; tests assert validation
  semantics and exit status rather than unstable diagnostic text.
- Retain the explicit managed-directory-link workaround until pinned Devenv fixes
  that behavior. Do not replace directory links with per-fixture Semgrep links.
- SecretSpec file-valued lifetime handling remains deferred.
- Intentional nonports: terraform-docs, ESLint, Gitignore snippet assets,
  scaffold/IDE/OS modules, old GitLab orchestration and the old CI cache image.

## Completed Factory infrastructure transitions

- Module-address split completed in run `39110692702`, retaining the existing
  bucket and `repository/prod`. Do not repeat it.
- Saved-plan/plan-reader rollout completed with Apply `39111226816`, receipt
  `12130102012`; normal private plan review replaced the temporary handoff.
- Storage audit rollout: source `99acec8`, Plan `39373527521`, receipt
  `12242591265`, approved Apply `39374387499`. All three log types were verified
  without exemptions. These are completed outcomes, not reusable approvals.
