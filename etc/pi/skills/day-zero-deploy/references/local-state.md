# New-installation local state

This is the shared, executable-by-phase runbook for a genuinely new repository
using Factory's `tf/modules/project/{github,gcp}` and protected reusable
workflows. Each phase requires separate approval; do not paste the whole document
into a shell. Inventory the repository, support projects, buckets, WIF and
local/remote state before any mutation. If any installation exists, stop and
adopt its state rather than bootstrap again.

## 1. Identity and inputs

Use the pinned direnv shell and the credential-free default SecretSpec profile.
Do not select `plan`/`apply` while bootstrapping: their CI inputs are not ready.
Keep credentials in the process environment, not Nix attributes or shell history.
Google CLI login, ADC, the operator's GitHub login and the provider PAT are distinct.

```sh
set -euo pipefail
set +x
umask 077

# One-time Day Zero for the explicitly selected owner/repository. Publish the
# reviewed repo on main first (use a PR if required); confirm its actual Check
# status. Plan and Apply are manual-only; wait until prod is provisioned.
# Stop if this root already has local/remote state or a support project; adopt
# that state instead. Run in the repo's pinned direnv shell; verify project
# creator and billing access to the selected folder/account, not assumptions
# about a different repository's organization or credentials.

# Authenticate locally and check the operator-supplied inputs.
gcloud auth login
gcloud auth application-default login # select the same Google account
: "${GCP_BILLING_ACCOUNT:?set the authorized billing account}"
: "${GCP_FOLDER_ID:?set the quantile-co parent folder ID}"
: "${GCP_MAINTAINERS:?set a JSON array of Google account emails for plan review}"
: "${GCP_WIF_POOL:?set the Q0 GitHub WIF pool resource path}"
: "${GCP_WIF_PROVIDER:?set the Q0 quantile-co GitHub WIF provider path}"
: "${GH_MAINTAINERS:?set a JSON array of GitHub usernames}"
: "${GH_REPO_TOKEN:?load a repository-scoped token from a secure local source}"

# Map public names to Terraform inputs; keep the GitHub token out of TF_VAR_*.
export TF_VAR_gcp_billing_account="$GCP_BILLING_ACCOUNT"
export TF_VAR_gcp_folder_id="$GCP_FOLDER_ID"
export TF_VAR_gcp_maintainers="$GCP_MAINTAINERS"
export TF_VAR_gcp_wif_pool="$GCP_WIF_POOL"
export TF_VAR_gh_maintainers="$GH_MAINTAINERS"

gh auth status # operator's GitHub CLI login, not the provider token
: "${GH_REPOSITORY:?set the intended owner/repository from an approved secure context}"
test "$GH_REPOSITORY" = "$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
REPOSITORY_NAME=$(gh repo view --json name --jq .name)
test "$GH_REPOSITORY" = "${GH_REPOSITORY%/*}/$REPOSITORY_NAME"
export GITHUB_TOKEN="$GH_REPO_TOKEN" # provider credential only for local Terraform
export REST_API_BEARER="$GH_REPO_TOKEN" # REST provider uses the same runtime token
# Verify the existing pool maps main_branch_repository_actor_id and the
# provider accepts this repository's owner. Do not impersonate Q0 break-glass.

```

## 2. Local seed and imports

Confirm no existing installation or backend initialization. Local file absence
alone is not sufficient. Approve each import separately; inspect other existing
resources before creating anything.

```sh
# Start with local state: the bucket does not exist yet.
test ! -e tf/infrastructure/backend_override.tf
test ! -e tf/infrastructure/terraform.tfstate
unset TF_DATA_DIR TF_WORKSPACE
printf 'terraform {\n  backend "local" {}\n}\n' > tf/infrastructure/backend_override.tf
tofu -chdir=tf/infrastructure init -input=false -lockfile=readonly

# The repository already exists. Import it ONLY when it has no state address.
tofu -chdir=tf/infrastructure import module.github.github_repository.self "$REPOSITORY_NAME"
tofu -chdir=tf/infrastructure plan

# Review existing repo settings, the observed required Check context, and all changes.
# Import any other existing resources before approving a fresh local plan.
```

After separate bootstrap Apply approval, inspect the interactive plan again
before confirming it. This local bootstrap exception is not the ordinary CI path.

```sh
tofu -chdir=tf/infrastructure apply
```

## 2a. Out-of-band project deletion lien

After the new project's approved local Apply, protect the state project from
accidental deletion **outside Terraform**. The lien is not a Terraform resource,
import, state address, or CI task. Use the operator's authenticated `gcloud`
identity, which must have `resourcemanager.projects.updateLiens` on the project
(for example, `roles/resourcemanager.lienModifier`); listing also requires
`resourcemanager.projects.get`. Google CLI authentication is separate from the
ADC used by Terraform. Do not grant these permissions or impersonate Q0
break-glass as an implicit part of bootstrap. Stop for separate authorization
if the selected identity lacks access.

Obtain the project ID from the applied local state, verify it is the intended
new project, and inspect existing liens before creating anything. If an
appropriate deletion lien already exists, stop rather than create a duplicate.
The read, credential choice, creation, and verification are separately approved
operations; do not run this block as one automated script.

```sh
GCP_PROJECT_ID=$(tofu -chdir=tf/infrastructure output -raw gcp_tf_state_project_id)
: "${GCP_PROJECT_ID:?verify the new state project ID}"
gcloud config get-value account
# After read-only inspection is approved:
gcloud alpha resource-manager liens list --project="$GCP_PROJECT_ID" --format=json
# Only after separately approving creation for this exact project:
gcloud alpha resource-manager liens create \
  --project="$GCP_PROJECT_ID" \
  --restrictions=resourcemanager.projects.delete \
  --reason="Protect this project from deletion." \
  --origin=operator
# Verify the returned name, project, origin, reason, and restriction:
gcloud alpha resource-manager liens list --project="$GCP_PROJECT_ID" --format=json
```

Using `--impersonate-service-account` and `--billing-project` requires separate
approval and verified token-creation, lien-modification and quota-project
permissions. A break-glass account is not the default bootstrap identity.
Keep the returned lien name in private operator records, never Git or Terraform
state. Do not remove the lien during normal state migration, CI handoff, or
Terraform teardown. An exceptional removal requires separate approval for the
**exact** lien name: inspect the project's liens again, then run
`gcloud alpha resource-manager liens delete "$GCP_LIEN_NAME"` for only that
verified name. Never bulk-delete the project's liens.

## 3. State migration

Authorize migration separately. Verify the output bucket and preserve the state
backup privately. Move this same lineage; never reset state or force-copy over
an existing backend. Stop if the post-migration plan is not clean.

```sh
# Move that same local state to its new, versioned GCS bucket.
GCP_TF_STATE_BUCKET=$(tofu -chdir=tf/infrastructure output -raw gcp_tf_state_bucket)
GCP_PROJECT_ID=$(tofu -chdir=tf/infrastructure output -raw gcp_tf_state_project_id)
cp tf/infrastructure/terraform.tfstate tf/infrastructure/terraform.tfstate.pre-gcs
rm tf/infrastructure/backend_override.tf
tofu -chdir=tf/infrastructure init -migrate-state -lockfile=readonly \
  -backend-config="bucket=$GCP_TF_STATE_BUCKET" \
  -backend-config="prefix=repository/prod"
tofu -chdir=tf/infrastructure state list
tofu -chdir=tf/infrastructure plan # expect no changes; keep the ignored backup securely until verified
unset GITHUB_TOKEN # gh run watch cannot use the Terraform fine-grained PAT
unset REST_API_BEARER
```

## 4. CI configuration

Verify the main/maintainer/prod/WIF guards and the existing Namespace runner.
Confirm `CACHIX_AUTH_TOKEN` is available to the protected workflow steps; do not
print or recreate existing secrets. Approve variable and secret changes before
running the following commands.

```sh
# Provision nonsecret repository variables for CI.
: "${GH_REPOSITORY:?use the same verified owner/repository as the local seed}"
gh variable set GCP_BILLING_ACCOUNT --repo "$GH_REPOSITORY" --body "$GCP_BILLING_ACCOUNT"
gh variable set GCP_FOLDER_ID --repo "$GH_REPOSITORY" --body "$GCP_FOLDER_ID"
# Also populate the compatibility alias used by some Factory-based callers.
gh variable set GCP_QUANTILE_CO_FOLDER_ID --repo "$GH_REPOSITORY" --body "$GCP_FOLDER_ID"
gh variable set GCP_MAINTAINERS --repo "$GH_REPOSITORY" --body "$GCP_MAINTAINERS"
gh variable set GCP_WIF_POOL --repo "$GH_REPOSITORY" --body "$GCP_WIF_POOL"
gh variable set GCP_WIF_PROVIDER --repo "$GH_REPOSITORY" --body "$GCP_WIF_PROVIDER"
gh variable set GH_MAINTAINERS --repo "$GH_REPOSITORY" --body "$GH_MAINTAINERS"
gh variable set GCP_PROJECT_ID --repo "$GH_REPOSITORY" --body "$GCP_PROJECT_ID"
gh variable set GCP_TF_STATE_BUCKET --repo "$GH_REPOSITORY" --body "$GCP_TF_STATE_BUCKET"
# Alias for callers that pass TF_STATE_BUCKET as the state-bucket input.
gh variable set TF_STATE_BUCKET --repo "$GH_REPOSITORY" --body "$GCP_TF_STATE_BUCKET"

# Verify prod permits ONLY main, not tags, before adding secrets.
printf '%s' "$GH_REPO_TOKEN" | gh secret set GH_REPO_TOKEN --repo "$GH_REPOSITORY" --env prod

```

## 5. CI handoff

Read [Plan and Apply](../../deploy/references/plan-apply.md). The helper below
watches a single dispatch; an ambiguous result is not permission to dispatch
again. It forwards workflow inputs so Apply can select its Plan artifact.

```sh
# Both workflows are published but manual-only. Dispatch only after prod is
# protected, populated, and the remote-state plan above is clean.
run_and_verify() {
  output=$(gh workflow run "$@" --repo "$GH_REPOSITORY" --ref main 2>&1)
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
```

Download and inspect the GCS plan using the deploy reference. Record its
`RUN_ID/ATTEMPT/GENERATION` reference from the Plan summary, verify its exact
producing attempt and obtain separate approval for Apply. A successful Plan is
not Apply authorization.

```sh
: "${PLAN_RUN_ID:?select the Plan run ID}"
: "${PLAN_ATTEMPT:?select the producing attempt}"
: "${PLAN_GENERATION:?select the GCS plan generation}"
read -r -p 'Type APPLY after reviewing the successful CI Plan: ' answer </dev/tty
test "$answer" = APPLY
run_and_verify apply.yaml -f "plan_ref=$PLAN_RUN_ID/$PLAN_ATTEMPT/$PLAN_GENERATION"
```

## 6. Remove bootstrap access

After successful CI handoff, verify WIF and Q0-admin recovery access, and the
Terraform-managed plan-reader bindings for `gcp_maintainers`. These grant object
read access only under `plans/`, not state access or Owner. Verify the operator's
Google account is included before removing bootstrap access. If read access is
missing, stop for a separately approved Terraform change; do not retain or
restore Owner merely to inspect plans.

Inspect IAM first, then obtain separate approval to remove only the bootstrap
human's direct, unconditional Owner grant. Preserve standing folder
`projectCreator`, billing `billing.user`, CI/WIF and recovery grants.

```sh
# After both CI runs succeed, inspect project IAM. Remove ONLY a direct
# roles/owner grant to the Day Zero human, if project creation gave them one;
# keep the standing folder projectCreator and billing.user domain grants.
creator=$(gcloud config get-value account)
: "${creator:?use the same Google account for gcloud and Terraform ADC}"

# Confirm this active gcloud account is the same human who used ADC above.
gcloud projects get-iam-policy "$GCP_PROJECT_ID" --format=json
```

Only after the narrow IAM removal is approved:

```sh
if gcloud projects get-iam-policy "$GCP_PROJECT_ID" --format=json |
  jq -e --arg member "user:$creator" \
    'any(.bindings[]?; .role == "roles/owner" and (.members | index($member)))' >/dev/null; then
  gcloud projects remove-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="user:$creator" --role=roles/owner --condition=None
fi
# Recheck IAM and CI Plan after handoff. Preserve approved recovery admins.
# Never commit credentials, local state, .terraform/, or saved plans.
```

Reinspect IAM and verify private plan read access. Separately authorize a new CI
Plan to confirm the handoff; do not infer permission to Apply it.

```sh
gcloud projects get-iam-policy "$GCP_PROJECT_ID" --format=json
# After separate approval:
run_and_verify plan.yaml
```

Keep private backups until state and recovery are verified. Remove only your own
no-longer-needed local overrides and scratch; never commit them.
