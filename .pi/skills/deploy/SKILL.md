---
name: deploy
description: Plan, review, apply or troubleshoot existing Factory infrastructure through protected workflows and a saved-plan artifact ID. Not a new-installation bootstrap.
---

# Deploy

Read [Plan and Apply](references/plan-apply.md). Work from the repository root in
its pinned direnv shell. Read `AGENTS.md`, `.pi/memory/MEMORY.md`, current `tf/`,
`nix/tf/default.nix`, `devenv.nix` and the relevant workflow before acting.

Skill invocation, a source merge or a green Check is not authorization to run
Plan or Apply. Obtain separate approval for each dispatch, credential operation,
state repair or retry. Preserve main/maintainer/prod guards, WIF, backend locks,
shared production concurrency and deletion protection.

Never reseed existing infrastructure or use a local Apply to bypass CI. For a
confirmed new installation only, use [Day Zero](../day-zero-deploy/SKILL.md).
Keep credentials, state, plans and provider payloads out of Git and public logs.

On failure, inspect the exact run and affected state before proposing recovery.
A failed or timed-out Apply may have changed resources. Do not replay uncertain
writes, disable locking, cancel another operator's job or widen permissions.
