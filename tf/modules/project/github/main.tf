# The caller configures providers. Only one instance owns a repository's settings.
# Adopt an existing repository by importing it rather than creating another.
data "github_user" "maintainer" {
  for_each = var.maintainers

  username = each.value
}

resource "github_repository" "self" {
  name        = var.repository_name
  description = var.description
  visibility  = var.visibility

  has_issues      = var.has_issues
  has_discussions = false
  has_projects    = false
  has_wiki        = false

  allow_auto_merge       = false
  allow_merge_commit     = false
  allow_squash_merge     = true
  allow_rebase_merge     = false
  delete_branch_on_merge = true
  archive_on_destroy     = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_actions_repository_permissions" "self" {
  repository           = github_repository.self.name
  enabled              = true
  allowed_actions      = "selected"
  sha_pinning_required = true

  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = true
    patterns_allowed = [
      "quantile-co/factory/.github/workflows/*@*",
      "cachix/install-nix-action@13d8dd58da0234aa297dedd986986ccb8e7f3e24",
      "cachix/cachix-action@38b082610b782e7e93e209c35fd730d399dee866",
      "namespacelabs/nscloud-cache-action@1124a6f3ce44e5cf84cc22111530961f4d2a15f9",
    ]
  }
}

# GitHub exposes this approval policy only for public repositories.
resource "restapi_object" "fork_workflow_approval" {
  count      = var.visibility == "public" ? 1 : 0
  depends_on = [github_actions_repository_permissions.self]

  path          = "/repos/${github_repository.self.full_name}/actions/permissions"
  object_id     = "fork-pr-contributor-approval"
  create_path   = "/repos/${github_repository.self.full_name}/actions/permissions/{id}"
  create_method = "PUT"

  # Removing this singleton from state must not weaken the remote policy.
  destroy_method = "GET"
  data           = jsonencode({ approval_policy = "all_external_contributors" })
}

moved {
  from = restapi_object.fork_workflow_approval
  to   = restapi_object.fork_workflow_approval[0]
}

resource "github_repository_vulnerability_alerts" "self" {
  repository = github_repository.self.name
  enabled    = true
}

resource "github_repository_dependabot_security_updates" "self" {
  depends_on = [github_repository_vulnerability_alerts.self]

  repository = github_repository.self.name
  enabled    = true
}

resource "github_branch_protection" "main" {
  repository_id           = github_repository.self.node_id
  pattern                 = var.main_branch
  enforce_admins          = true
  allows_deletions        = false
  allows_force_pushes     = false
  force_push_bypassers    = []
  required_linear_history = true
  require_signed_commits  = true

  required_status_checks {
    strict   = true
    contexts = var.required_checks
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_environment" "main" {
  for_each = var.environments

  repository  = github_repository.self.name
  environment = each.value

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "main" {
  for_each = var.environments

  repository     = github_repository.self.name
  environment    = github_repository_environment.main[each.key].environment
  branch_pattern = var.main_branch
}
