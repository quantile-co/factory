# The caller supplies repository/actor IDs; this module needs no GitHub provider.
resource "random_id" "state" {
  byte_length = 2
}

resource "google_project" "state" {
  name                = "${var.project_prefix}-${random_id.state.hex}"
  project_id          = "${var.project_prefix}-${random_id.state.hex}"
  folder_id           = var.folder_id
  billing_account     = var.billing_account
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

resource "google_project_iam_audit_config" "storage" {
  project = google_project.state.project_id
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Cloud Audit Logs records storage access; main.rego requires all three log types.
# https://cloud.google.com/storage/docs/access-logs#should-you-use
# nosemgrep: terraform.gcp.security.gcp-cloud-storage-logging.gcp-cloud-storage-logging
resource "google_storage_bucket" "state" {
  depends_on = [google_project_service.storage, google_project_iam_audit_config.storage]

  project                     = google_project.state.project_id
  name                        = "${google_project.state.project_id}-tf-state"
  location                    = var.tf_state_location
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

  # Plan cleanup is prefix-scoped and asynchronous.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age            = 1
      matches_prefix = ["plans/"]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      days_since_noncurrent_time = 1
      matches_prefix             = ["plans/"]
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Human plan review must work after bootstrap Owner access is removed.
# The object-prefix condition excludes state and bucket-wide object listing.
resource "google_storage_bucket_iam_member" "plan_reader" {
  for_each = var.maintainers

  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectViewer"
  member = "user:${each.value}"

  condition {
    title      = "read-saved-plans"
    expression = "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.state.name}/objects/plans/\")"
  }
}

# Routine administration is limited to main-branch repository/actor WIF principals.
# Do not grant persistent project Owner access to the bootstrap human.
resource "google_project_iam_member" "pipeline_owner" {
  for_each = var.repository_maintainer_ids

  project = google_project.state.project_id
  role    = "roles/owner"
  member  = "principalSet://iam.googleapis.com/${var.wif_pool}/attribute.main_branch_repository_actor_id/${var.repository_id}_${each.value}"
}
