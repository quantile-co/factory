# The caller configures providers and backend; this module owns one repository
# and its dedicated state project. Adopt an existing repository by importing it.
data "github_user" "maintainer" {
  for_each = var.gh_maintainers

  username = each.value
}

resource "github_repository" "self" {
  name        = var.gh_repository_name
  description = var.gh_description
  visibility  = var.gh_visibility

  has_issues      = var.gh_has_issues
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
  pattern                 = var.gh_main_branch
  enforce_admins          = true
  allows_deletions        = false
  allows_force_pushes     = false
  force_push_bypassers    = []
  required_linear_history = true
  require_signed_commits  = true

  required_status_checks {
    strict   = true
    contexts = var.gh_required_checks
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Only repository writers may land; these bypasses apply to the update rule,
# never to independent signed-commit, check, and linear-history protection.
resource "github_repository_ruleset" "member_landing" {
  name        = "member-landing"
  repository  = github_repository.self.name
  target      = "branch"
  enforcement = "active"

  bypass_actors {
    actor_id    = 2 # Maintain
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  bypass_actors {
    actor_id    = 4 # Write
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  bypass_actors {
    actor_id    = 5 # Admin
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  bypass_actors {
    actor_type  = "OrganizationAdmin"
    bypass_mode = "always"
  }

  conditions {
    ref_name {
      include = ["refs/heads/${var.gh_main_branch}"]
      exclude = []
    }
  }

  rules {
    update = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_environment" "main" {
  for_each = var.gh_environments

  repository  = github_repository.self.name
  environment = each.value

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "main" {
  for_each = var.gh_environments

  repository     = github_repository.self.name
  environment    = github_repository_environment.main[each.key].environment
  branch_pattern = var.gh_main_branch
}

resource "random_id" "state" {
  byte_length = 2
}

resource "google_project" "state" {
  name                = "${var.gcp_project_prefix}-${random_id.state.hex}"
  project_id          = "${var.gcp_project_prefix}-${random_id.state.hex}"
  folder_id           = var.gcp_folder_id
  billing_account     = var.gcp_billing_account
  auto_create_network = false
  deletion_policy     = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_service" "storage" {
  project            = google_project.state.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  depends_on = [google_project_service.storage]

  project                     = google_project.state.project_id
  name                        = "${google_project.state.project_id}-tf-state"
  location                    = var.gcp_tf_state_location
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      days_since_noncurrent_time = 90
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# CI is the sole *routine* project administrator after local Day Zero. Grant
# only the existing pool's trusted main-branch repository/actor principals;
# no persistent project Owner binding is made for the human project creator.
resource "google_project_iam_member" "pipeline_owner" {
  for_each = var.gh_maintainers

  project = google_project.state.project_id
  role    = "roles/owner"
  member  = "principalSet://iam.googleapis.com/${var.gcp_wif_pool}/attribute.main_branch_repository_actor_id/${github_repository.self.repo_id}_${data.github_user.maintainer[each.key].id}"
}
