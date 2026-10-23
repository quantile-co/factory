output "tf_state_bucket" {
  description = "Private, versioned bucket name for the caller's remote backend."
  value       = google_storage_bucket.state.name
}

output "project_id" {
  description = "Dedicated GCP project ID containing the state bucket."
  value       = google_project.state.project_id
}

output "project_number" {
  description = "GCP project number."
  value       = google_project.state.number
}
