# Project configuration contract

## Operator settings

Use the consuming repository's pinned shell and deployment procedures. These
settings describe the current Factory contract; verify the consumer's configuration.
A source change, successful Check or Plan never authorizes a deployment.

| Setting | Value and purpose |
| --- | --- |
| `GH_REPO` | Verified `owner/repo` for the GitHub CLI; not a basename or numeric ID. |
| `TF_DIR` | Reviewed Terraform root path: `tf/infrastructure` for Factory, or the consumer's selected root. |
| `TF_LAYER` | Offered workflow layer: `infrastructure` or `application`; passed as `tf_layer`. |
| `GCP_WIF_POOL` | Trusted `projects/NUMBER/locations/global/workloadIdentityPools/POOL` resource path. |
| `GCP_WIF_PROVIDER` | Trusted pool path followed by `/providers/PROVIDER`, used by CI authentication. |
| `GH_PLAN_REF` | One complete `RUN_ID/ATTEMPT/GENERATION` value from the successful Plan summary; three positive decimal integers without leading zeros. |

The concrete Terraform root owns reviewed `project_owners` and `project_members`
locals. They are source configuration, not CLI/environment inputs or Actions
owner rosters. WIF values remain Actions configuration variables; Day Zero supplies
WIF at runtime before CI exists. `GH_REPO`, `TF_DIR`, `TF_LAYER` and `GH_PLAN_REF`
are procedure inputs, not additional standing repository variables. The workflow
bridges `gh_plan_ref` through a step-local `GH_PLAN_REF` variable before passing
it as a quoted `--gh-plan-ref` argument. Trusted repository variables go directly
to `--gcp-tf-state-bucket` and `--gcp-wif-pool`. Only the credential uses Commander
`.env()`; the plan-reference bridge keeps input data out of shell source. Native Actions repository/run/attempt IDs,
runner scratch and summary paths are read directly, not repeated as CLI flags.
Shared templates offer both layer jobs; `tf_layer` selects one per dispatch and
is passed as `--tf-layer` to the repository's pnpm task/app. That repository maps
the layer internally to its directory and existing backend prefix. Shared YAML
contains neither directory nor backend-prefix arguments. Set
`github.workflows.layers` to the supported subset. Factory selects Infrastructure
only, mapped by its app to `tf/infrastructure`, with the source target
`factory/prod/infrastructure`. Backend prefixes follow
`<repository-name>/<environment>/<tf-layer>`, preserving dots in repository names.
Changing an existing prefix requires a separately approved same-lineage state
migration before activating its new source mapping; never initialize an empty
backend as a replacement. Plan and Apply must select the same layer.

A synthetic owner-roster example, not identities to deploy:

```json
[{"gcp_email":"owner@example.com","gh_username":"example-owner"}]
```

Confirm every pairing. Emails and usernames must each be unique across owners
and members, ignoring case. Do not infer usernames from emails. Preserve spelling
for existing Terraform instance keys.

### Credentials stay separate

`GH_REPO_TOKEN` is the repository-scoped provider credential. Use this same name
for the protected environment secret, workflow environment and Commander `.env()`
option (`--gh-repo-token`). Workflows prefer environment-based credentials; users
may choose flags. Only the provider subprocess receives the internal native
`GITHUB_TOKEN` and `REST_API_BEARER` mappings. The storage subprocess receives
neither. Keep organization credentials distinct as `GH_ORG_TOKEN` or an
organization-qualified name such as `GH_QUANTILE_CO_ORG_TOKEN`; do not combine
privileges to standardize names. The operator's GitHub CLI login remains separate.
`CACHIX_AUTH_TOKEN` remains a separate workflow secret. Google CLI login, ADC
and CI WIF are distinct authentication contexts. Keep credentials out of Git,
Terraform inputs, Nix values and public logs.

### Turbo cache access

Turbo uses local caching by default. CI persists `.turbo/cache` on the existing
Namespace volume and uses remote team `main` in the caller's workspace.
Keep Restricted runners and main-only volume publication.

Use the native `TURBO_TOKEN` secret name at both scopes: an organization/repository
read-only cache token for internal Check, and a cache-only read/write token
overriding it in `prod` for trusted main Test and Build. Test, Build, Plan and Apply
use the existing `prod` environment wherever those workflows exist; there is no
separate cache environment. Preserve its branch restrictions. Never store a writer
token at organization/repository scope.
Environment policies control credential delivery; Namespace token grants enforce
read/write access. Keep expiring token payloads CLI-managed, outside Terraform,
Git and Nix. Missing tokens fall back to local caching. Fork PRs and PR authors
outside OWNER/MEMBER/COLLABORATOR receive no remote token.

Local developers use a reader-scoped credential, not a general login token:

```sh
export $(nsc cache turborepo setup --team main --read-only --token /secure/path/reader.json)
pnpm run build
```

Use the correct workspace's token. The setup token is short-lived; rerun setup
when it expires. `--read-only` sets client behavior, not server authorization.
Explicit cache tokens work on Restricted runners; no access-level change is needed.
Do not relax runner access to bypass a failure. Cache only
reproducible build outputs and safe logs, never credentials, state or saved plans.

### Concrete values are not overrides

Factory's `tf/infrastructure/main.tf` holds its approved billing account, parent
folder and bucket location. Billing/folder IDs identify resources; they do not
authorize access or charges. Publishing them still reveals account/hierarchy
metadata. Verify the deployed values and approve publication for each concrete
root; never copy private consumer configuration into public Factory.

Shared workflows and Day Zero do not supply billing/folder environment
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

The Terraform root owns `local.project_owners` and `local.project_members`. It directly
projects emails into the GCP module and usernames into the GitHub module; there
is no intermediary identity module. Each platform module owns its permissions:

- GitHub owners are looked up for `owner_ids`; the lookup itself grants no
  repository or organization membership. Members receive repository write
  access (`push`), not administration.
- GCP owners receive object-read access only under `plans/`, not state access.
  `gh_repo_id` and `gh_owner_ids` retain main/repository/actor-scoped WIF.
  There is no direct human project Owner grant.
- Members receive no added GCP or WIF grants.
  Platform modules reject overlap between owner and member identities.

The workflow CLI neither reads nor forwards owner/member rosters. Terraform
projects the source records directly into its platform modules. YAML has no owner
or triggering-actor list checks; dispatch access follows repository/environment
policy, while the existing WIF/IAM configuration restricts GCP access. Review parses
`GH_PLAN_REF` internally and selects its exact GCS generation; Apply receives the
same reference without replanning. Review and Apply require separate approval.

These grants do not revoke inherited organization, team or GCP permissions.
Review effective access, including collaborator removal when a member leaves
or changes roles. Repository writers remain within the existing branch-protection
and trusted-workflow model.

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
