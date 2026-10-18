---
name: day-zero-deploy
description: Bootstrap a genuinely new Factory installation, migrate local state to GCS, hand off to protected CI, and remove the bootstrap operator's direct Owner grant. Never reseed an existing installation.
---

# Day Zero

Read [the bootstrap procedure](references/local-state.md) completely before acting.
Work from the repository root in its pinned direnv shell. Read `AGENTS.md`,
`.pi/memory/MEMORY.md`, current `tf/`, `nix/tf.nix` and the production workflows.

Confirm the target and inventory existing resources and state first. An empty
checkout or missing local state does not prove this is a new installation.
For existing infrastructure, use [deploy](../deploy/SKILL.md).

Execute only the explicitly approved phase. Each credential operation, import,
Apply, migration, IAM change, workflow dispatch or retry needs its own approval.
Do not run the procedure end-to-end. This is a runbook, not evidence that a fresh
installation has been tested against the current source.

Keep state, plans, credentials and provider responses out of Git, public logs
and Nix outputs. Preserve WIF, backend locks and recovery access. After CI handoff,
remove only the bootstrap human's direct Owner grant, never standing folder,
billing, CI or recovery grants.
