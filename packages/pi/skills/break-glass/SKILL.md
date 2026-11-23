---
name: break-glass
description: Verify recovery access, temporarily elevate a named Day Zero operator, and remove the exact grant after handoff. Not for routine Plan or Apply.
---

# Break-glass and temporary elevation

Use a designated recovery service account only for an explicitly authorized IAM
operation or recovery action. For routine deploys use protected CI. A member
bootstrapping their own project uses existing creation and billing access, not
organization administration. Route shared infrastructure changes to its owner.

1. Identify the installation's recovery account and quota project from trusted
    configuration. Verify the operator can impersonate that account. Check the
    effective permission on the **target resource** as that account, without a
    write. Being able to use a role does not mean being able to delegate it.
    If the path is unavailable, stop; do not expand your own access to fix it.
2. Record the operator, target, missing role, purpose and UTC expiry. Obtain
    approval for that exact grant. Inspect the current policy: leave pre-existing
    bindings alone. Use the narrowest resource and an expiring IAM condition;
    if the binding cannot take a condition, stop for a separately reviewed path.
3. Impersonate only for the grant operation, not as a CLI default, in ADC, or via
    a service-account key. Verify the exact new binding. End impersonation before
    running Terraform. Use the operator's own credentials for the local seed and
    the repository's protected workflow identity after handoff.
4. Once CI and recovery are verified, use per-command impersonation to remove
    the recorded binding, including its exact condition. Verify it is absent and
    unrelated grants, especially CI and recovery, are intact. Expiry limits
    access; it does not delete the binding. On failure or interruption, reconcile
    the actual policy before retrying and arrange cleanup of any outstanding grant.

For emergency recovery, authorize the exact action separately; temporary
bootstrap access is not approval to delete a project, remove a lien, or bypass
protected deployment. Keep access tokens, raw policies and state out of logs.
