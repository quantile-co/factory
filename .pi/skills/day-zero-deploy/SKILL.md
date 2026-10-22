---
name: day-zero-deploy
description: Bootstrap a genuinely new Factory-module installation, migrate local state to GCS, hand off to protected saved-plan workflows, and remove the bootstrap operator's direct Owner grant. Never reseed an existing installation.
---

# Day Zero

Read [the full shared bootstrap procedure](references/local-state.md) before
acting. Work from the consuming repository root in its pinned direnv shell.
Read `AGENTS.md`, `.pi/memory/MEMORY.md`, the current Terraform root, its
pinned Factory module sources, the consumer's shell and task scripts, and production workflow callers
**and** called workflows. Set `TF_DIR` to the root selected by those scripts. Do not substitute unverified bootstrap instructions
or assume a local checkout without state is a fresh installation.

Confirm the target and inventory existing resources and local/remote state
first. For an existing installation use [deploy](../deploy/SKILL.md). Execute
only an explicitly approved phase. Each credential operation, import, Apply,
state migration, IAM change, workflow dispatch or retry needs separate approval.
The code examples are a phase-by-phase procedure, not permission to run all of
them end-to-end or evidence that every consumer has been bootstrapped.

Supply the verified owner/repository, billing, folder, WIF, maintainers and
provider token from approved sources at runtime. Never hardcode a Factory
repository identity into consumer source or expose token values through Nix,
Terraform inputs, Git or public logs. Preserve WIF, locks, backups and recovery
access. After CI handoff remove only the bootstrap human's direct Owner grant,
never standing creator/billing, CI or recovery grants.
