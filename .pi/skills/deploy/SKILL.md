---
name: deploy
description: Plan, privately review, apply or troubleshoot existing Factory-module infrastructure through protected reusable workflows and an exact saved-plan GCS generation. Not a new-installation bootstrap.
---

# Deploy

Read [the configuration contract](references/configuration.md) and
[the full Plan and Apply procedure](references/plan-apply.md). Work from
the consuming repository root in its pinned direnv shell. Read `AGENTS.md`,
`.pi/memory/MEMORY.md`, the current Terraform root, its Factory module
references, the consumer's shell and task scripts, and the pinned caller **and** called workflows.
Use the root selected by those scripts as `TF_DIR`; Factory defaults to
`tf/infrastructure`, while single-root consumers may use `tf`.

Skill invocation, a source merge, a green Check or a successful Plan is not
authorization to Apply. Obtain separate approval for each dispatch, credential
operation, state repair or retry. Preserve main/owner/prod guards, WIF,
backend locks, shared production concurrency and deletion protection.

Never reseed existing infrastructure or use local Apply to bypass CI. For a
confirmed new installation use [Day Zero](../day-zero-deploy/SKILL.md). Keep
credentials, state, plans and provider payloads out of Git and public logs.

On failure inspect the exact run and affected state before recovery. A failed
or timed-out Apply may have changed resources. Do not replay uncertain writes,
disable locking, cancel another operator's job or widen permissions.
