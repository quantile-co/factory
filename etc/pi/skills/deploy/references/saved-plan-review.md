# Review a saved plan privately

First follow the repository's Plan procedure to verify the producing run,
source revision, target and selected layer. Keep main fixed during review.
Apply trusts the operator's choice; it does not check the producing source.
Use the pinned shell and an authorized plan reader, not broader IAM grants.

Set `REPO`, the reviewed Terraform root `TF_DIR`, the producing bucket and all
three components of `RUN_ID/ATTEMPT/GENERATION`. Keep downloads and provider
schemas outside Git and the Nix store:

```sh
set -euo pipefail; set +x; umask 077
: "${REPO:?verified owner/repository}"
: "${TF_DIR:?reviewed Terraform root}"
: "${GCP_TF_STATE_BUCKET:?verified producing Plan bucket}"
: "${PLAN_RUN_ID:?Plan run ID}"
: "${PLAN_ATTEMPT:?producing attempt}"
: "${PLAN_GENERATION:?GCS plan object generation}"
[[ "$PLAN_RUN_ID/$PLAN_ATTEMPT/$PLAN_GENERATION" =~ ^[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*$ ]]
gh api "repos/$REPO/actions/runs/$PLAN_RUN_ID/attempts/$PLAN_ATTEMPT" \
  --jq '{id,run_attempt,head_sha,path,event,status,conclusion,created_at}'
```

Confirm the response is the intended successful Plan attempt on the reviewed
source before downloading. An ambiguous or failed run is not reviewable success.

```sh
REVIEW_DIR=$(mktemp -d)
repository_id=$(gh api "repos/$REPO" --jq .id)
base="gs://$GCP_TF_STATE_BUCKET/plans/$repository_id/$PLAN_RUN_ID/$PLAN_ATTEMPT"
gcloud storage cp "$base/saved-plan/plan.tfplan#$PLAN_GENERATION" "$REVIEW_DIR/plan.tfplan"
test -s "$REVIEW_DIR/plan.tfplan"
TF_DATA_DIR="$REVIEW_DIR/schemas" tofu -chdir="$TF_DIR" init \
  -backend=false -input=false -lockfile=readonly
TF_DATA_DIR="$REVIEW_DIR/schemas" tofu -chdir="$TF_DIR" show -no-color \
  "$REVIEW_DIR/plan.tfplan" > "$REVIEW_DIR/plan.txt"
TF_DATA_DIR="$REVIEW_DIR/schemas" tofu -chdir="$TF_DIR" show -json \
  "$REVIEW_DIR/plan.tfplan" > "$REVIEW_DIR/plan.json"
```

Read the complete private plan and variables, including replacements, deletions,
IAM, repository policy and state protections. Follow the repository's additional
checks for DNS, releases or application resources. Never paste plans or provider
payloads into public logs or issues. Stop on unexpected changes or a changed
source/state; request a new Plan rather than substituting another object.
Review does not authorize Apply. Preserve these exact identifiers and the
private directory between shell calls; remove only your own scratch after review.
