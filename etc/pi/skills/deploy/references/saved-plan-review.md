# Review a saved plan privately

First follow the repository's Plan procedure to verify the producing run,
source revision, target and selected layer. Keep main fixed during review.
Apply trusts the operator's choice; it does not check the producing source.
Use the pinned shell and an authorized plan reader, not broader IAM grants.

Set `GH_REPO`, the reviewed Terraform root `TF_DIR`, the producing bucket and
`PLAN_REF` copied as `RUN_ID/ATTEMPT/GENERATION` from the Plan summary. The
components below are derived helpers, not additional inputs. Keep downloads
and provider schemas outside Git and the Nix store:

```sh
set -euo pipefail; set +x; umask 077
: "${GH_REPO:?verified owner/repo}"
repo=$(env -u GH_REPO gh repo view --json nameWithOwner --jq .nameWithOwner)
test "$GH_REPO" = "$repo"
: "${TF_DIR:?reviewed Terraform root}"
: "${GCP_TF_STATE_BUCKET:?verified producing Plan bucket}"
: "${PLAN_REF:?reviewed run/attempt/generation}"
[[ "$PLAN_REF" =~ ^([1-9][0-9]*)/([1-9][0-9]*)/([1-9][0-9]*)$ ]]
plan_run_id=${BASH_REMATCH[1]}
plan_attempt=${BASH_REMATCH[2]}
plan_generation=${BASH_REMATCH[3]}
gh api "repos/$GH_REPO/actions/runs/$plan_run_id/attempts/$plan_attempt" \
  --jq '{id,run_attempt,head_sha,path,event,status,conclusion,created_at}'
```

Confirm the response is the intended successful Plan attempt on the reviewed
source before downloading. An ambiguous or failed run is not reviewable success.

```sh
REVIEW_DIR=$(mktemp -d)
repo_id=$(gh api "repos/$GH_REPO" --jq .id)
base="gs://$GCP_TF_STATE_BUCKET/plans/$repo_id/$plan_run_id/$plan_attempt"
gcloud storage cp "$base/saved-plan/plan.tfplan#$plan_generation" "$REVIEW_DIR/plan.tfplan"
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
Review does not authorize Apply. Preserve `PLAN_REF`, its derived components and
the private directory between shell calls; remove only your own scratch after
review. Do not change the reference between review and the approved Apply.
