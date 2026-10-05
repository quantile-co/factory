output "gcp_tf_state_bucket" {
  description = "Private, versioned bucket name for the caller's remote backend."
  value       = google_storage_bucket.state.name
}

output "gcp_tf_state_project_id" {
  description = "Dedicated GCP project ID containing the state bucket."
  value       = google_project.state.project_id
}

output "gh_branch_protection_id" {
  description = "Protected main-branch rule ID."
  value       = github_branch_protection.main.id
}

output "gh_environment_names" {
  description = "Names of the main-branch-only GitHub environments."
  value       = toset([for environment in github_repository_environment.main : environment.environment])
}

output "gh_repository_id" {
  description = "Immutable numeric repository ID used to scope WIF principals."
  value       = github_repository.self.repo_id
}

output "gh_repository_name" {
  description = "Repository name in the configured GitHub provider owner."
  value       = github_repository.self.name
}
