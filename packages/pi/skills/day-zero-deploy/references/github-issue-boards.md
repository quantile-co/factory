# GitHub issue boards

After verifying the new repository and GCP project and completing the
privileged bootstrap handoff, provision the board as a separate, approved
GitHub CLI phase. An approved board-only setup on an existing repository does
not run Terraform or change IAM. The board is a GitHub Projects v2 project, not
another repository, GCP project, or Terraform state resource.

## Inventory and approve

Verify the repository's full name and visibility. Create one project in that
organization titled `OWNER/REPO`, link it to that repository, and use only
that repository as the source of its cards. The final project is public for a
public repository and private for a private or internal repository.

Use the approved operator's GitHub login, not the repository-scoped Terraform
credential. The login needs project write access and read access to each source
repository. If the stored `gh` OAuth login lacks `project`, get separate approval
before the operator runs `gh auth refresh -h github.com -s project` and completes
the browser authorization. Inventory the owner's projects before deciding
whether to create one:

```bash
gh project list --owner "$owner" --closed --limit 100 --format json
```

Compare the returned list length to `totalCount` and increase the limit if
needed. Reuse a confirmed matching project; stop on an incomplete lookup,
ambiguous match, or unexpected existing configuration.

## Create and configure

Use the confirmed owner and title. Create only if absent, and keep the returned
project number. If creation has an ambiguous result, inventory again before
retrying.

```bash
# Only after approval and a successful inventory confirms absence:
project=$(gh project create --owner "$owner" --title "$title" \
  --format json --jq .number)
# Start private while reviewing the board. Link only the approved repository:
gh project edit "$project" --owner "$owner" --visibility PRIVATE
gh project link "$project" --owner "$owner" --repo "$repo_name"
```

For a public repo, verify every card is a public issue from that repo. Review
project-only content too: draft or archived cards, description, README,
custom fields and values, view names, and status updates. Keep private links,
nonpublic security details, and internal notes off the public board. Only
then run `gh project edit "$project" --owner "$owner" --visibility PUBLIC`.
For private or internal repos, leave the project private.

Open the project with `gh project view "$project" --owner "$owner" --web`.
Save an **Open issues** view using **Table** layout and `is:issue is:open`,
without grouping, sorting, or an assignee filter. Show these columns in order:

1. Title
2. Sub-issues progress
3. Assignees
4. Status
5. Labels
6. Created
7. Updated

Hide **Repository** (all rows come from the same repo) and **Closed**. Keep the
ordinary statuses **Todo**, **In Progress**, and **Done**. Dependabot is an
issue label, not a project status.

## Seed and keep current

The Factory GitHub module manages the `dependabot` label. If it already exists
but isn't in state, adopt it with a reviewed import rather than creating it
again. Apply the label only to issues tracking a Dependabot PR or security
alert, including alerts with no PR. The linked PR or alert determines the
label, not the issue author. No label is required for a card to enter a board.

Set **Item added to project** to **Todo** for all new issues. If converting
an existing project, first apply and verify the `dependabot` issue label on
all cards using the old **Dependabot** status. Then move those cards to
**Todo**, remove the obsolete option, and preserve all other statuses.

Check both open Dependabot PRs and open security alerts when reviewing this
backlog. File each tracking issue in the repository the PR or alert applies to.
For an alert without a PR, check the updater error. If the repository is public,
link to the restricted alert without copying package impact or updater
diagnostics into the public issue. Add only the tracking issue to the repository
project. Apply the issue label when filing or triaging the tracking issue.

List all open issues in the confirmed repository with the paginated repository
endpoint. It includes PRs; exclude them and review the complete result before
adding any items.

```bash
gh api --paginate "repos/$source_repo/issues?state=open&per_page=100" \
  --jq '.[] | select(.pull_request == null) | .html_url'
# Repeat only for approved URLs not already on the board:
gh project item-add "$project" --owner "$owner" --url "$issue_url"
```

If `item-add` returns an ambiguous GraphQL error, check whether the item was
added before retrying. If absent, use `gh api graphql` with
`addProjectV2ItemById`, passing the verified project node ID and the issue's
`node_id` from `gh api repos/OWNER/REPO/issues/NUMBER`. Verify the returned issue
URL matches the reviewed input.

## Enable and verify automatic intake

The saved view filter only displays cards already on the board. The standard
GitHub Terraform provider does not manage Projects v2 workflows. In each
board's **⋯ → Workflows → Auto-add to project → Edit**, choose the source
repository, enter `is:issue is:open`, then save and turn on the rule. Leave
labels and assignees out of the [Auto-add filter](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically).
Linking the repository to the project does not create a rule.

Native rules do not backfill existing issues. If native intake is unavailable,
record the gap; use a separately approved reconciliation for intake. The Open
issues view hides closed items retained in project history.

Verify the project URL, owner and visibility with `gh project view`; check
that visibility matches the repository and compare
paginated project items with the open-issue inventory. Confirm the table's
visible columns and order, that tracking issues carry the `dependabot` label,
and that no PRs or out-of-scope issues were added.
Verify native intake on the next eligible issue creation or update. Record
board URLs, seed counts, and which repositories have verified ongoing intake;
report rules that are enabled but have not yet been exercised.
