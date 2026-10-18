output "branch_protection_id" {
  description = "Protected main-branch rule ID."
  value       = github_branch_protection.main.id
}

output "environment_names" {
  description = "Names of the main-branch-only GitHub environments."
  value       = toset([for environment in github_repository_environment.main : environment.environment])
}

output "maintainer_ids" {
  description = "GitHub usernames mapped to immutable actor IDs for reuse across GCP projects."
  value       = { for name, maintainer in data.github_user.maintainer : name => maintainer.id }
}

output "repository_id" {
  description = "Immutable numeric repository ID used to scope WIF principals."
  value       = github_repository.self.repo_id
}

output "repository_name" {
  description = "Repository name in the configured GitHub provider owner."
  value       = github_repository.self.name
}
