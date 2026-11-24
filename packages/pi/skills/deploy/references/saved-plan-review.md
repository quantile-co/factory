# Review a saved plan privately

Start with the exact `RUN_ID` and `ATTEMPT` from the approved Plan dispatch,
not a search for the latest successful Plan. The Actions Summary is optional.
Use an authorized plan reader and the consumer's pinned shell (Node 24, locked `tsx`, `gh`,
`gcloud`, OpenTofu). Run from the consumer root in a private, unrecorded shell,
not a CI job, traced shell or agent tool that captures plan output.

## Verify the consumer configuration

1. Supply the approved full `SHA`, `GH_REPO` (`owner/repo`) and `TF_LAYER`.
    Read the caller and any pinned called workflow at that revision. Verify the
    protected main/prod `plan.yaml`, selected layer job and its `Plan` step.
    Trace the step through the consumer's actual task to the root (`TF_DIR`),
    backend prefix and Factory create-only upload. Another workflow, an
    unrecognized job layout or a non-create-only writer is not this procedure.
2. Verify the **effective producing** `GCP_TF_STATE_BUCKET` from the caller,
    task arguments and Actions configuration (including `prod` overrides).
    For a repository variable use `gh variable get GCP_TF_STATE_BUCKET -R
    "$GH_REPO"`; for an environment variable add `--env prod`. Check for
    overrides even if the repository value exists. A denied lookup is not an
    absent override. Compare with the approved backend identity; current
    variables alone are not proof if configuration has changed since the run.
    Stop if the bucket, layer-to-root mapping or producer cannot be established.
3. Confirm the operator's GitHub login and active `gcloud` plan-reader identity.
    Do not use the provider PAT, assume CI's identity, request bucket listing,
    or widen access. If a Summary reference is available, set `SUMMARY_REF` to
    that entire value; otherwise leave it **unset**. Do not request the Summary
    as a prerequisite.

## Resolve and inspect one generation

Set `DEPLOY_SKILL` to the absolute directory containing this installed Factory
`deploy` skill. Use Bash; keep `/tmp` on trusted local storage outside any
checkout, backup, shared snapshot or Nix build. Use a fresh directory per review.

```bash
set -euo pipefail; set +x; umask 077
: "${GH_REPO:?}" "${SHA:?}" "${RUN_ID:?}" "${ATTEMPT:?}" "${TF_LAYER:?}"
: "${GCP_TF_STATE_BUCKET:?}" "${TF_DIR:?reviewed root}" "${DEPLOY_SKILL:?}"
test "$GH_REPO" = "$(env -u GH_REPO gh repo view --json nameWithOwner --jq .nameWithOwner)"
test "$SHA" = "$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
test "$SHA" = "$(gh api "repos/$GH_REPO/git/ref/heads/main" --jq .object.sha)"
test -d "$TF_DIR"
REVIEW_DIR=$(mktemp -d /tmp/factory-review.XXXXXXXX)
trap 'rm -rf -- "$REVIEW_DIR"' EXIT
summary=(); if [[ -v SUMMARY_REF ]]; then summary+=("$SUMMARY_REF"); fi
GH_PLAN_REF=$(pnpm exec tsx "$DEPLOY_SKILL/fetch-plan.ts" "$GH_REPO" "$SHA" "$TF_LAYER" \
  "$RUN_ID" "$ATTEMPT" "$GCP_TF_STATE_BUCKET" "$REVIEW_DIR" "${summary[@]}")
export TF_DATA_DIR="$REVIEW_DIR/schemas"
tofu -chdir="$TF_DIR" init -backend=false -input=false -lockfile=readonly \
  >"$REVIEW_DIR/init.log" 2>&1
tofu -chdir="$TF_DIR" show -no-color "$REVIEW_DIR/plan.tfplan" \
  >"$REVIEW_DIR/plan.txt" 2>"$REVIEW_DIR/show.log"
tofu -chdir="$TF_DIR" show -json "$REVIEW_DIR/plan.tfplan" \
  >"$REVIEW_DIR/plan.json" 2>>"$REVIEW_DIR/show.log"
```

The helper checks the exact attempt and successful layer job before reading
metadata for `plans/REPOSITORY_ID/RUN_ID/ATTEMPT/saved-plan/plan.tfplan`.
It checks the object's creation time against the producing Plan step and
compares any supplied Summary. It downloads **only** the discovered generation
and checks the returned generation, size and absence of replacement during
download. A missing object (404), denied reader (401/403), failed producer or
metadata mismatch means **stop**. A failed pre-OpenTofu run may never have saved
a plan. Never retry with an unversioned download, different run or broader IAM.

Read the complete rendering and variables privately, including replacements,
deletions, IAM, repository policy and state protections. Apply the consumer's
additional checks for DNS, releases or application resources. Report only the
versioned `GH_PLAN_REF` and a sanitized review result (for example, counts and
whether the changes match the approved scope). Do not paste bytes, renderings,
logs, credentials or provider payloads into Git, tickets, chat or shared memory.
Exit the private shell to remove its scratch. A successful download is **not**
a successful review or Apply approval. If source/state changes or drift is
unexpected, stop. Any Apply requires separate approval for the same reviewed
layer and reference; never dispatch Apply from this procedure.
