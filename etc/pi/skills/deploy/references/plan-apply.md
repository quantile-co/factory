# Plan and Apply

Read the caller's current workflows, the pinned Factory reusable workflows,
the consumer's shell and task scripts, its Terraform root and declared Factory
Terraform module sources, and `nix/github/workflows/default.nix` from the pinned
Factory revision. Export `TF_DIR` to the root selected by the consumer's workflow
scripts (`tf/infrastructure` for Factory, or `tf` for a single-root consumer).
Changing this source directory does not change the backend bucket or prefix.
Use the pinned direnv shell. Ordinary production changes use protected workflows,
not local Apply. Validate source without backend access:

```sh
pnpm run check
```

## Layout changes on an existing installation

For existing installations, compare the resource addresses in state with this
repository's modules and any `moved` blocks. Obtain separate
approval for any one-time address migration. Do not apply a plan that recreates
or deletes existing resources because of a refactor. When the original bucket
and existing prefix are retained, this is not a backend migration or a new
installation. Some installations also intentionally retire resources;
review those deletions individually. No compatibility blocks or state moves
run automatically.

## Local OpenTofu (exceptional, separately authorized)

Ordinary production Plan/Apply must use protected workflows. If an operator
explicitly authorizes a local exception, enter the pinned shell and supply
provider credentials at runtime from an approved source. Set
`TF_PLAN_FILE` to an absolute private path outside Git and the Nix store;
keep its bytes restricted for review. Use the existing bucket and prefix:

```sh
set -euo pipefail; set +x; umask 077
: "${GCP_TF_STATE_BUCKET:?Set the existing bucket}"
: "${TF_BACKEND_PREFIX:?Set the existing prefix}"
: "${TF_PLAN_FILE:?Set an absolute private plan path}"
case "$TF_PLAN_FILE" in /*) ;; *) exit 1 ;; esac
: "${TF_DIR:?Set the reviewed Terraform root}"
tofu -chdir="$TF_DIR" init -input=false -lockfile=readonly \
  -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
  -backend-config="prefix=$TF_BACKEND_PREFIX"
test ! -e "$TF_PLAN_FILE"
tofu -chdir="$TF_DIR" plan -input=false -no-color -out="$TF_PLAN_FILE"
```

A *separately approved* local Apply uses the exact reviewed saved bytes, with
fresh runtime credentials and the same backend configuration. Never replan
in place of Apply:

```sh
set -euo pipefail; set +x; umask 077
: "${GCP_TF_STATE_BUCKET:?Set the reviewed bucket}"
: "${TF_BACKEND_PREFIX:?Set the reviewed prefix}"
: "${TF_PLAN_FILE:?Set the reviewed absolute private plan path}"
case "$TF_PLAN_FILE" in /*) ;; *) exit 1 ;; esac
test -s "$TF_PLAN_FILE"
: "${TF_DIR:?Set the reviewed Terraform root}"
tofu -chdir="$TF_DIR" init -input=false -lockfile=readonly \
  -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
  -backend-config="prefix=$TF_BACKEND_PREFIX"
tofu -chdir="$TF_DIR" apply -input=false "$TF_PLAN_FILE"
```

## 1. Confirm context

From a clean checkout of the current protected main revision:

```sh
set -euo pipefail
set +x
umask 077
: "${TF_DIR:?Set the reviewed Terraform root}"
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
the effective state bucket and backend prefix, including caller inputs and runtime
environment overrides. Factory defaults to `repository/prod`; consumers may retain
another existing prefix. Check the called workflow's `factory-production`
concurrency and any caller guard.
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
post-steps. Copy `RUN_ID/ATTEMPT/GENERATION` from the Plan step summary.

No plan or diagnostic is uploaded to GitHub. The saved plan and its private
Plan log stay in GCS under `plans/REPOSITORY_ID/RUN_ID/ATTEMPT/saved-plan/`.
An authorized reader needs access to those objects independently of CI's WIF
identity. Manage missing read access through `gcp_maintainers` and a separately
approved Terraform Apply, not a manual IAM grant, Owner access or public upload.
An existing authorized reader must inspect the initial access-grant plan; setting
the input alone grants nothing.

## 3. Inspect the plan privately

Set all three components from the reviewed Plan reference. Verify its
producing run and selected source revision manually; Apply trusts the operator's
choice and does not perform GitHub run or source checks. Keep all downloads
outside the checkout and Nix store.

```sh
: "${PLAN_RUN_ID:?set the Plan run ID}"
: "${PLAN_ATTEMPT:?set the producing attempt}"
: "${PLAN_GENERATION:?set the GCS plan object generation}"
gh run watch "$PLAN_RUN_ID" -R "$REPO" --exit-status
gh api "repos/$REPO/actions/runs/$PLAN_RUN_ID/attempts/$PLAN_ATTEMPT" \
  --jq '{id,run_attempt,head_sha,path,event,status,conclusion,created_at}'
PRIVATE_DIR=$(mktemp -d)
repository_id=$(gh api "repos/$REPO" --jq .id)
# Set the exact effective bucket from the reviewed Plan caller and its variables.
: "${GCP_TF_STATE_BUCKET:?Set and verify the producing Plan's state bucket}"
base="gs://$GCP_TF_STATE_BUCKET/plans/$repository_id/$PLAN_RUN_ID/$PLAN_ATTEMPT"
gcloud storage cp "$base/saved-plan/plan.tfplan#$PLAN_GENERATION" "$PRIVATE_DIR/plan.tfplan"
tofu -chdir="$TF_DIR" show -no-color "$PRIVATE_DIR/plan.tfplan" > "$PRIVATE_DIR/plan.txt"
```

Read the complete private `plan.txt`, including replacements, deletions, IAM,
repository policy and state protections. Do not paste its contents into public
logs or issues. Stop on unexpected changes. Review does not authorize Apply.

## 4. Apply

After separate approval for this exact run/attempt/generation:

```sh
gh workflow run apply.yaml -R "$REPO" --ref main \
  -f "plan_ref=$PLAN_RUN_ID/$PLAN_ATTEMPT/$PLAN_GENERATION"
```

Apply downloads that exact GCS plan generation into a local file, then runs
OpenTofu Apply without replanning. The protected Apply gate and the operator's
review of the selected reference are the authorization boundary. OpenTofu's
backend state locking and stale-plan checks remain active. If the source has
changed, the plan is missing, or the state has advanced, stop and review a new
Plan rather than applying a different object. GCS lifecycle cleanup is
asynchronous; do not assume old objects have already been deleted.

Watch the exact Apply run. A failed Plan stores a create-only `plan.log` under
`gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT/`.
A failed Apply stores `apply.log` under
`gs://$GCP_TF_STATE_BUCKET/plans/$GITHUB_REPOSITORY_ID/apply/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT/`.
Fetch diagnostics only as an authorized reader into restricted scratch outside Git
and the Nix store. Provider output is redirected to local private logs, not
printed in the workflow. Diagnostic upload can
itself fail; absence is not proof that no infrastructure changed. GCS cleanup
follows the plans-prefix lifecycle.

Failure or timeout may follow a partial write: inspect state and completed
operations before proposing recovery. Do not rerun Day Zero, force-unlock an
active backend, replay an uncertain Apply or run workflows solely to warm caches.
Remove only your own private scratch after verification; preserve uncertain
results and backups securely until recovery is understood.
