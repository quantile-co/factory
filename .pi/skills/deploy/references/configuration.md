# Project configuration contract

## Operator settings

Use the consuming repository's pinned shell and deployment procedures. These
settings describe the current Factory contract, not an already migrated consumer.
A source change, successful Check or Plan never authorizes a deployment.

| Setting | Value and purpose |
| --- | --- |
| `GH_REPO` | Verified `owner/repo` for the GitHub CLI; not a basename or numeric ID. |
| `TF_DIR` | Reviewed Terraform root path: `tf/infrastructure` for Factory, or the consumer's selected root. |
| `PROJECT_OWNERS` | Required nonempty JSON list of paired `gcp_email` and `gh_username` records. |
| `PROJECT_MEMBERS` | Optional paired JSON list, default `[]`; repository writers, not deployment actors. |
| `GCP_WIF_POOL` | Trusted `projects/NUMBER/locations/global/workloadIdentityPools/POOL` resource path. |
| `GCP_WIF_PROVIDER` | Trusted pool path followed by `/providers/PROVIDER`, used by CI authentication. |
| `PLAN_REF` | One complete `RUN_ID/ATTEMPT/GENERATION` value from the successful Plan summary; three positive decimal integers without leading zeros. |

The rosters and WIF values are GitHub Actions configuration variables; Day Zero
supplies them at runtime before CI exists. `GH_REPO`, `TF_DIR` and `PLAN_REF` are
procedure inputs, not additional standing repository variables. Apply's native
workflow input is `plan_ref`; its adapter passes `PLAN_REF` internally.

A synthetic owner-roster example, not identities to deploy:

```json
[{"gcp_email":"owner@example.com","gh_username":"example-owner"}]
```

Confirm every pairing. Emails and usernames must each be unique across owners
and members, ignoring case. Do not zip old platform lists or infer usernames
from emails. Preserve spelling for existing Terraform instance keys.

### Credentials stay separate

`GH_REPO_TOKEN` is the repository-scoped provider credential, stored as a
protected environment secret for CI. It is not the operator's GitHub CLI login.
`CACHIX_AUTH_TOKEN` remains a separate workflow secret. Google CLI login, ADC
and CI WIF are distinct authentication contexts. Keep credentials out of Git,
Terraform inputs, Nix values and public logs.

### Concrete values are not overrides

Factory's `tf/infrastructure/main.tf` holds its approved billing account, parent
folder and bucket location. Billing/folder IDs identify resources; they do not
authorize access or charges. Publishing them still reveals account/hierarchy
metadata. Verify the deployed values and approve publication for each concrete
root; never copy private consumer configuration into public Factory.

Shared workflows and Day Zero no longer supply billing/folder environment
variables. Reusable GCP module parameters `billing_account`, `folder_id` and
`tf_state_location` remain configurable for other roots. A new repository chooses
its own approved values; it does not inherit Factory's installation identity.

## Generated identifiers

Do not invent new identifiers for an existing installation. Record generated
project/bucket values as CI variables only after verifying the intended resources.

| Source | Consumer or meaning |
| --- | --- |
| `module.gcp.project_id` → root `gcp_project_id` | `GCP_PROJECT_ID` for CI authentication. |
| `module.gcp.project_number` | Numeric GCP project identity; distinct from its string project ID. |
| `module.gcp.tf_state_bucket` → root `gcp_tf_state_bucket` | `GCP_TF_STATE_BUCKET`, the existing backend and saved-plan bucket. |
| `module.gh.repo_id` → root `gh_repo_id` | Immutable numeric GitHub ID, also passed to GCP as `gh_repo_id`. |
| `module.gh.repo_name` | Repository basename within the configured provider owner. |
| `module.gh.owner_ids` | Owner usernames mapped to immutable GitHub actor IDs. |

`repo_name` is also the GitHub module's basename input. It is not `GH_REPO`.
Retain `tf_state` on the bucket: it identifies purpose, not a transport mechanism.
Keep role qualifiers where multiple projects coexist; do not collapse distinct
project identities merely to shorten names.

## Platform roles and native adapters

The Terraform root owns `project_owners` and `project_members`. It directly
projects emails into the GCP module and usernames into the GitHub module; there
is no intermediary identity module. Each platform module owns its permissions:

- GitHub owners are looked up for `owner_ids`; the lookup itself grants no
  repository or organization membership. Members receive repository write
  access (`push`), not administration.
- GCP owners receive object-read access only under `plans/`, not state access.
  `gh_repo_id` and `gh_owner_ids` retain main/repository/actor-scoped WIF.
  There is no direct human project Owner grant.
- Members receive no GCP grants, WIF access or protected Plan/Apply eligibility.
  Platform modules reject overlap between owner and member identities.

Workflow adapters map `PROJECT_OWNERS` and `PROJECT_MEMBERS` to `TF_VAR_*`.
Both original and triggering actors must appear in the owner roster; an absent
roster admits neither. Members never participate in those gates. Review parses
`PLAN_REF` internally and selects its exact GCS generation; Apply receives the
same reference without replanning. Review and Apply require separate approval.

These grants do not revoke inherited organization, team or GCP permissions.
Review effective access, including collaborator removal when a member leaves
or changes roles. Repository writers remain within the existing branch-protection
and trusted-workflow model; actor gates do not isolate trusted workflow source.

Use `GH_` / `gh_` and `GCP_` / `gcp_` for unscoped Quantile-owned names. Keep
`TF_VAR_*`, backend arguments and local plan paths inside adapters or exceptional
procedures. Preserve native provider/SDK attributes and variables, including
`repository_id`, `GITHUB_*`, `REST_API_BEARER` and
`GOOGLE_APPLICATION_CREDENTIALS`. Keep `GH_REPO` unset during independent checkout
verification, and explicit repository targets on mutations.

Same-named `STRIPE_API_KEY` or `RESEND_API_KEY` inputs in isolated contexts need
not have equal values or privileges. Qualify credentials only when they coexist;
never combine privileges to simplify names. There is no member GCP/admin-role
override or supported local-production Apply shortcut.

## Tool configuration files

Actionlint, clang-format and clang-tidy use native configuration discovery.
Other wrappers retain explicit paths where they inspect settings or change
working roots. Retained selectors use `<TOOL>_CONFIG_FILE`; upstream-native
names stay unchanged. `PREK_CONFIG_FILE` is shared by the Prek and keep-sorted
adapters. Nix `configFile` options select native templates, not a second policy
registry. Materialize files into their native locations, not runtime `etc/` paths.

## Breaking changes and consumer migration

No compatibility aliases are provided. Coordinate pins, roots, output users,
workflow sources, generated copies and stored settings before activation.
Consumers keep their existing backend bucket, prefix, lineage and instance keys.

| Previous interface | Replacement |
| --- | --- |
| Root `gcp_maintainers` and `gh_maintainers` | Paired `project_owners`; `project_members` defaults to empty |
| GH `GCP_MAINTAINERS` and `GH_MAINTAINERS` | `PROJECT_OWNERS`; optional `PROJECT_MEMBERS` |
| Platform-module `maintainers` | Directly projected `owners`; separate `members` |
| GitHub `maintainer_ids` | `owner_ids` |
| GitHub `repository_name`, `repository_id` | `repo_name`, `repo_id` |
| GCP `repository_id` / `gh_repository_id`, `repository_maintainer_ids` | `gh_repo_id`, `gh_owner_ids` |
| Root `gh_repository_id` | `gh_repo_id` |
| GCP `tf_state_project_id`, `tf_state_project_number` | `project_id`, `project_number` |
| Root `gcp_tf_state_project_id` | `gcp_project_id` |
| Root `module.github` | `module.gh`, with an explicit address move |
| Runbook `REPO` / `GH_REPOSITORY` | Native `GH_REPO`; verify checkout with the selector unset |
| `PLAN_RUN_ID`, `PLAN_ATTEMPT`, `PLAN_GENERATION` | One operator-supplied `PLAN_REF` |
| GH `TF_STATE_BUCKET` | `GCP_TF_STATE_BUCKET` |
| Concrete-root billing/folder inputs and GH variable aliases | Verified, approved literals; reusable module parameters remain |
| Factory root `gcp_tf_state_location` | Verified `US`; reusable module retains `tf_state_location` |
| `ACTIONLINT_CONFIG_FILE`, `CLANG_FORMAT_CONFIG`, `CLANG_TIDY_CONFIG` | Native file discovery |
| `EDITORCONFIG_CHECKER_CONFIG` | `EDITORCONFIG_CHECKER_CONFIG_FILE` |
| `GO_LINT_CONFIG` | `GOLANGCI_LINT_CONFIG_FILE` |
| `GIT_HOOKS_CONFIG` | `PREK_CONFIG_FILE` |

Confirm old identity pairings and effective access first. If pairing changes
permissions, obtain a separate role-policy decision rather than promoting an
unmatched reader to owner. Existing platform source directories remain
`project/github` and `project/gcp`; provider/resource names are not renamed.

Factory includes a temporary `module.github` → `module.gh` move. Consumers
renaming module calls need equivalent reviewed moves. Output renames change
interfaces, not resource identity. Never accept replacements caused by naming
or a bucket-location assumption. Remove migration scaffolding only after
separately authorized rollout and convergence.

Retire stored aliases only after all consumers stop using them. WIF, main/prod
restrictions, concurrency and backend locks remain unchanged. Use a new saved
plan after migration; never replay a plan from the old contract. Q0 stays
Factory-independent. Consumer-specific procedures and private facts remain in
the owning repository.
