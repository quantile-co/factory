# Project memory

Read any repository instructions present in this checkout before changing code or production behavior; source and reviewed workflows are authoritative.

Store only durable, reviewed project-specific facts here. Never commit credentials, customer data, provider payloads, daily logs, scratchpad or recovery data. Review every change to this file before committing.


<!-- 2026-10-15 20:22:53 [01a14275] -->
#decision [[factory-config-layout]] Factory is a shared Nix flake, not a shared devenv configuration. Keep tool configuration files as raw, native-format supplemental/example assets under root `etc/`, separate from `nix/`. Tool-specific Nix modules may reference/package those files, but must not encode configs as elaborate mergeable devenv/Nix data structures or force their placement. Downstream repositories choose whether to consume the flake's modules or config files, patch/override the files, and place them where they need them. Keep `etc/` reusable by other packaging systems (e.g. OS or npm packages). This intentionally replaces the complex config-in-Nix/devenv approach from the older devenv and July 12a repositories. Keep `nix/ts.nix` available for downstreams but do not include its Node package in factory's own devenv shell until needed for repo code. Port source directories from those older repos one at a time, checking with the user before each directory; do not port unattended.


<!-- 2026-10-15 20:59:33 [01a14275] -->
#decision [[factory-executable-config]] Reusable check/plan/apply executables live as ordinary Nix packages exposed through the shared tool modules, independent of devenv. They read the consuming repository's native configuration paths at runtime (with explicit runtime overrides when needed); never bake paths to factory's `etc/` templates into those executables. Each repo chooses whether to copy, patch, generate, or link templates from `etc/` into its own tool locations. Factory's devenv tasks only orchestrate the packages; CI wrappers retain protected environments, WIF, manual authorization, and concurrency. Production Apply must create a fresh saved plan and apply those exact bytes in one guarded job.


<!-- 2026-10-15 22:48:34 [01a14275] -->
#decision [[factory-member-landing]] Do not port the old devenv `tf/project` `github_repository_ruleset.member_landing` into Factory. Factory previously had this update-only ruleset; active Restrict updates blocked ordinary green squash PR merges unless an explicit ruleset bypass was used. Switching only that rule to evaluate let a normal squash merge succeed. On 2026-10-05 the user decided GitHub's existing Write/Maintain/Admin permissions (including deliberately authorized write-capable bots) plus independent main branch protection were sufficient and approved removing the redundant rule. The authorized Apply removed only that ruleset (0 added, 0 changed, 1 destroyed), and a follow-up Plan was clean. The old devenv index still contains the obsolete rule; do not propose it as a Factory gap. Preserve Factory's separate signed-commit, strict All, linear-history, no-force-push/deletion protection.


<!-- 2026-10-15 23:13:26 [01a14275] -->
#decision [[factory-terraform-tests]] Factory's `tf/` source and tests must stand alone without Nix references: native HCL, Rego policies/Conftest tests, and TypeScript/Vitest module tests. Reusable tool packages/CLI integrations belong under `nix/tf/`; Factory's `devenv.nix` supplies this repository's policy/source paths and orchestrates native CLI and npm scripts. Keep `npm run typecheck` in `check:all` and `npm test` plus Rego unit tests in an independent generic `test:all` devenv task. Only the `Check / All` workflow runs before merging into main and remains the required context; a separate `Test / Tests` workflow runs tests on demand from main, with batching/scheduling to be decided later. Do not resurrect old devenv `member-landing` ruleset or optional WIF defaults: Factory and downstream repos should require WIF; IAM custom-role migration would be a separate infrastructure review.
