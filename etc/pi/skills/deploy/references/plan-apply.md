# Plan and Apply

Read the caller's current workflows, the pinned Factory reusable workflows,
`devenv.nix`, `tf/infrastructure/`, its declared Factory Terraform module
sources and `nix/opentofu/default.nix` from the pinned Factory revision.
Use the pinned direnv shell. Ordinary production changes use protected workflows,
not local Apply. Validate source without backend access:

```sh
devenv tasks run --show-output check:all
```

## Layout changes on an existing installation

For existing installations, compare the resource addresses in state with this
repository's modules and any `moved` blocks. Obtain separate
approval for any one-time address migration. Do not apply a plan that recreates
or deletes existing resources because of a refactor. When the original bucket
and `repository/prod` prefix are retained, this is not a backend migration or a
new installation. Some installations also intentionally retire resources;
review those deletions individually. No compatibility blocks or state moves
run automatically.

## 1. Confirm context

From a clean checkout of the current protected main revision:

```sh
set -euo pipefail
set +x
umask 077
: "${REPO:?Set and verify the intended owner/repository before any dispatch}"
test "$REPO" = "$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
SHA=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
test "$SHA" = "$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)"
gh run list -R "$REPO" -w check.yaml -c "$SHA" \
  --json databaseId,headSha,status,conclusion,url
gh run list -R "$REPO" --limit 10 \
  --json databaseId,workflowName,headSha,status,conclusion,url
```

Check may have run on the source branch before fast-forwarding main. Confirm its
exact SHA, not just the branch label. Inspect current production activity; never
cancel another operator's job. Verify main/maintainer/prod protection, WIF,
the effective state bucket (including caller input overrides), backend prefix
`repository/prod` and the called workflow's `factory-production` concurrency.
`TF_VAR_gcp_maintainers` is an explicit JSON array of Google account emails,
distinct from GitHub usernames. Where configured, Terraform grants these users
object-read access only under the bucket's `plans/` prefix; an empty array
grants **no** plan-read access.
The operator's GitHub CLI login is separate from the provider PAT;
do not let `GITHUB_TOKEN` or `GH_TOKEN` select the wrong credential.

Plan and Apply receive provider credentials and the Cachix token only at runtime.
Never copy those values into Terraform inputs, artifacts, source or Nix values.

## 2. Plan

After approval for this dispatch only:

```sh
gh workflow run plan.yaml -R "$REPO" --ref main
```

Capture its run ID and attempt from the result; an ambiguous dispatch is not
permission to dispatch again. Watch that exact run and require success, including
post-steps. Record the artifact ID for `plan-RUN_ID-ATTEMPT` from the run's artifacts.

The GitHub artifact is only a receipt. Plan contents stay in private GCS under
`plans/REPOSITORY_ID/RUN_ID/ATTEMPT/plan.tfplan`. An authorized reader needs access
to those objects independently of CI's WIF identity. Manage missing read access
through `gcp_maintainers` and a separately approved Terraform Apply, not a manual
IAM grant, Owner access or a public artifact upload. An existing authorized reader
must inspect the initial access-grant plan; setting the input alone grants nothing.

## 3. Inspect the plan privately

Set the IDs from the successful Plan. Confirm the receipt belongs to that run
and attempt, matches the intended SHA, and is unexpired. Keep all downloaded files
outside the checkout and Nix store.

```sh
: "${PLAN_RUN_ID:?set the Plan run ID}"
: "${PLAN_ATTEMPT:?set the producing attempt}"
: "${PLAN_ARTIFACT_ID:?set its artifact ID}"
gh run watch "$PLAN_RUN_ID" -R "$REPO" --exit-status
gh api "repos/$REPO/actions/runs/$PLAN_RUN_ID/attempts/$PLAN_ATTEMPT" \
  --jq '{id,run_attempt,head_sha,path,event,status,conclusion}'
gh api "repos/$REPO/actions/artifacts/$PLAN_ARTIFACT_ID" \
  --jq '{id,name,expired,created_at,workflow_run}'
ARTIFACT_NAME=$(gh api "repos/$REPO/actions/artifacts/$PLAN_ARTIFACT_ID" --jq .name)
test "$ARTIFACT_NAME" = "plan-$PLAN_RUN_ID-$PLAN_ATTEMPT"
PRIVATE_DIR=$(mktemp -d)
gh run download "$PLAN_RUN_ID" -R "$REPO" -n "$ARTIFACT_NAME" -D "$PRIVATE_DIR"
repository_id=$(gh api "repos/$REPO" --jq .id)
# Set the exact effective bucket from the reviewed Plan caller and its variables.
# Caller input overrides can select a bucket independently of the default variable.
: "${GCP_TF_STATE_BUCKET:?Set and verify the producing Plan's state bucket}"
generation=$(jq -er .generation "$PRIVATE_DIR/plan.json")
gcloud storage cp \
  "gs://$GCP_TF_STATE_BUCKET/plans/$repository_id/$PLAN_RUN_ID/$PLAN_ATTEMPT/plan.tfplan#$generation" \
  "$PRIVATE_DIR/plan.tfplan"
digest=$(jq -er .sha256 "$PRIVATE_DIR/plan.json")
printf '%s  %s\n' "$digest" "$PRIVATE_DIR/plan.tfplan" | sha256sum --check
tofu -chdir=tf/infrastructure show -no-color "$PRIVATE_DIR/plan.tfplan" > "$PRIVATE_DIR/plan.txt"
```

Read the complete private `plan.txt`, including replacements, deletions, IAM,
repository policy and state protections. Do not paste its contents into public
logs or issues. Stop on unexpected changes. Review does not authorize Apply.

## 4. Apply

After separate approval for this artifact ID:

```sh
gh workflow run apply.yaml -R "$REPO" --ref main \
  -f "plan_artifact_id=$PLAN_ARTIFACT_ID"
```

Apply validates the successful producing attempt, repository, current main SHA,
24-hour artifact age, backend identity and digests, then applies the saved plan
without replanning. A changed SHA, expired artifact or stale state requires a new
separately authorized Plan and review, not bypassing a guard. GCS lifecycle cleanup
is asynchronous and versioning/soft-delete can retain old objects longer; the
workflow's 24-hour validity limit is independent of physical deletion.

Watch the exact Apply run. Failure or timeout may follow a partial write: inspect
state and completed operations before proposing recovery. Do not rerun Day Zero,
force-unlock an active backend, replay an uncertain Apply or run workflows solely
to warm caches. Remove only your own private scratch after verification; preserve
uncertain results and backups securely until recovery is understood.
