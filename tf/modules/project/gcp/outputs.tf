output "tf_state_bucket" {
  description = "Private, versioned bucket name for the caller's remote backend."
  value       = google_storage_bucket.state.name
}

output "tf_state_project_id" {
  description = "Dedicated GCP project ID containing the state bucket."
  value       = google_project.state.project_id
}
