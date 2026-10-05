output "gcp_tf_state_bucket" {
  description = "Versioned GCS bucket for factory's remote Terraform state."
  value       = module.project.gcp_tf_state_bucket
}

output "gcp_tf_state_project_id" {
  description = "Dedicated project ID for factory's state infrastructure."
  value       = module.project.gcp_tf_state_project_id
}

output "gh_branch_protection_id" {
  description = "ID of factory's protected main branch."
  value       = module.project.gh_branch_protection_id
}

output "gh_repository_id" {
  description = "Immutable numeric ID of the factory GitHub repository."
  value       = module.project.gh_repository_id
}
