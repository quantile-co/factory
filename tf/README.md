# Day 0 runbook

```sh
set -euo pipefail
set +x
umask 077

# One-time Day Zero for quantile-co/factory. Publish the whole reviewed repo
# on main first (use a PR if required); wait for the Check / All job to pass.
# Plan and Apply are manual-only; do not dispatch until prod is provisioned.
# Stop if this root already has local/remote state or a support project; adopt
# that state and import/reconcile existing objects rather than creating another.
# Run inside factory's direnv shell as a quantile.co project creator. Q0 grants
# ordinary domain users folder projectCreator and billing.user; verify access.

# Authenticate locally and check the operator-supplied inputs.
gcloud auth login
gcloud auth application-default login # select the same Google account
: "${GCP_BILLING_ACCOUNT:?set the authorized billing account}"
: "${GCP_FOLDER_ID:?set the quantile-co parent folder ID}"
: "${GCP_WIF_POOL:?set the Q0 GitHub WIF pool resource path}"
: "${GCP_WIF_PROVIDER:?set the Q0 quantile-co GitHub WIF provider path}"
: "${GH_MAINTAINERS:?set a JSON array of GitHub usernames}"
: "${GH_TF_TOKEN:?load a repository-scoped token from a secure local source}"

# Map public names to Terraform inputs; keep the GitHub token out of TF_VAR_*.
export TF_VAR_gcp_billing_account="$GCP_BILLING_ACCOUNT"
export TF_VAR_gcp_folder_id="$GCP_FOLDER_ID"
export TF_VAR_gcp_wif_pool="$GCP_WIF_POOL"
export TF_VAR_gh_maintainers="$GH_MAINTAINERS"

gh auth status # use the operator's GitHub CLI login for provisioning and run checks
export GITHUB_TOKEN="$GH_TF_TOKEN" # provider credential only for local Terraform
# Verify the existing pool maps main_branch_repository_actor_id and the
# provider accepts this repository's owner. Do not impersonate Q0 break-glass.

# Start with local state: the bucket does not exist yet.
test ! -e tf/backend_override.tf
test ! -e tf/terraform.tfstate
unset TF_DATA_DIR TF_WORKSPACE
printf 'terraform { backend "local" {} }\n' > tf/backend_override.tf
tofu -chdir=tf init -input=false -lockfile=readonly

# The repository already exists. Import it ONLY when it has no state address.
tofu -chdir=tf import module.project.github_repository.self factory
tofu -chdir=tf plan

# Review existing repo settings, the passing All check, and all changes.
# Import any other existing resources before approving a fresh local plan.
tofu -chdir=tf apply

# Move that same local state to its new, versioned GCS bucket.
GCP_TF_STATE_BUCKET=$(tofu -chdir=tf output -raw gcp_tf_state_bucket)
GCP_PROJECT_ID=$(tofu -chdir=tf output -raw gcp_tf_state_project_id)
cp tf/terraform.tfstate tf/terraform.tfstate.pre-gcs
rm tf/backend_override.tf
tofu -chdir=tf init -migrate-state -lockfile=readonly \
  -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
  -backend-config="prefix=repository/prod"
tofu -chdir=tf state list
tofu -chdir=tf plan # expect no changes; keep the ignored backup securely until verified
unset GITHUB_TOKEN # gh run watch cannot use the Terraform fine-grained PAT

# Provision nonsecret repository variables for CI.
GH_REPOSITORY=quantile-co/factory
gh variable set GCP_BILLING_ACCOUNT --repo "$GH_REPOSITORY" --body "$GCP_BILLING_ACCOUNT"
gh variable set GCP_FOLDER_ID --repo "$GH_REPOSITORY" --body "$GCP_FOLDER_ID"
gh variable set GCP_WIF_POOL --repo "$GH_REPOSITORY" --body "$GCP_WIF_POOL"
gh variable set GCP_WIF_PROVIDER --repo "$GH_REPOSITORY" --body "$GCP_WIF_PROVIDER"
gh variable set GH_MAINTAINERS --repo "$GH_REPOSITORY" --body "$GH_MAINTAINERS"
gh variable set GCP_PROJECT_ID --repo "$GH_REPOSITORY" --body "$GCP_PROJECT_ID"
gh variable set GCP_TF_STATE_BUCKET --repo "$GH_REPOSITORY" --body "$GCP_TF_STATE_BUCKET"

# Verify prod (and non-prod) permit ONLY main, not tags, before adding secrets.
printf '%s' "$GH_TF_TOKEN" | gh secret set GH_TF_TOKEN --repo "$GH_REPOSITORY" --env prod

# Both workflows are published but manual-only. Dispatch only after prod is
# protected, populated, and the remote-state plan above is clean.
run_and_verify() {
  output=$(gh workflow run "$1" --repo "$GH_REPOSITORY" --ref main 2>&1)
  printf '%s\n' "$output"
  url=$(printf '%s\n' "$output" |
    grep -Eo 'https://github.com/[^[:space:]]+/actions/runs/[0-9]+' | head -1) || true
  : "${url:?GitHub did not return a run URL; inspect the dispatched run manually}"
  run_id=${url##*/}
  gh run watch "$run_id" --repo "$GH_REPOSITORY" --exit-status
  test "$(gh run view "$run_id" --repo "$GH_REPOSITORY" \
    --json conclusion --jq .conclusion)" = success
}

# Review a successful CI Plan before dispatching CI Apply.
run_and_verify plan.yaml
read -r -p 'Type APPLY after reviewing the successful CI Plan: ' answer </dev/tty
test "$answer" = APPLY
run_and_verify apply.yaml

# After both CI runs succeed, inspect project IAM. Remove ONLY a direct
# roles/owner grant to the Day Zero human, if project creation gave them one;
# keep the standing folder projectCreator and billing.user domain grants.
creator=$(gcloud config get-value account)
: "${creator:?use the same Google account for gcloud and Terraform ADC}"

# Confirm this active gcloud account is the same human who used ADC above.
gcloud projects get-iam-policy "$GCP_PROJECT_ID" --format=json
if gcloud projects get-iam-policy "$GCP_PROJECT_ID" --format=json |
  jq -e --arg member "user:$creator" \
    'any(.bindings[]?; .role == "roles/owner" and (.members | index($member)))' >/dev/null; then
  gcloud projects remove-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="user:$creator" --role=roles/owner --condition=None
fi
# Recheck IAM and CI Plan after handoff. Q0 admins retain exceptional recovery.
# Never commit credentials, local state, .terraform/, or saved plans.
```
