package terraform.project.gcp

import rego.v1

# New resource kinds or additional declarations need an ownership/security review.
valid_inventory if {
	object.keys(input.resource) == {
		"random_id", "google_project", "google_project_service", "google_storage_bucket",
		"google_project_iam_member", "google_storage_bucket_iam_member", "google_project_iam_audit_config",
	}
	every resources in input.resource {
		count(resources) == 1
		every declarations in resources {
			count(declarations) == 1
		}
	}
}

valid_state if {
	project := input.resource.google_project.state[0]
	project.auto_create_network == false
	project.deletion_policy == "PREVENT"
	project.lifecycle[0].prevent_destroy == true
	storage := input.resource.google_project_service.storage[0]
	storage.project == "${google_project.state.project_id}"
	storage.service == "storage.googleapis.com"
	storage.disable_on_destroy == false
	bucket := input.resource.google_storage_bucket.state[0]
	bucket.project == "${google_project.state.project_id}"
	bucket.force_destroy == false
	bucket.uniform_bucket_level_access == true
	bucket.public_access_prevention == "enforced"
	bucket.versioning[0].enabled == true
	bucket.lifecycle[0].prevent_destroy == true

	# This allowlist prevents plan cleanup from shortening state retention.
	{rule | some rule in bucket.lifecycle_rule} == {
		{"action": [{"type": "Delete"}], "condition": [{"days_since_noncurrent_time": 90}]},
		{"action": [{"type": "Delete"}], "condition": [{"age": 1, "matches_prefix": ["plans/"]}]},
		{"action": [{"type": "Delete"}], "condition": [{"days_since_noncurrent_time": 1, "matches_prefix": ["plans/"]}]},
	}
}

# Bucket-log delivery is not required when Cloud Audit Logs covers storage access.
valid_audit_logging if {
	audit := input.resource.google_project_iam_audit_config.storage[0]
	audit.project == "${google_project.state.project_id}"
	audit.service == "storage.googleapis.com"
	{entry | some entry in audit.audit_log_config} == {
		{"log_type": "ADMIN_READ"},
		{"log_type": "DATA_READ"},
		{"log_type": "DATA_WRITE"},
	}
}

valid_readers if {
	reader := input.resource.google_storage_bucket_iam_member.plan_reader[0]
	reader.for_each == "${var.maintainers}"
	reader.bucket == "${google_storage_bucket.state.name}"
	reader.role == "roles/storage.objectViewer"
	reader.member == "user:${each.value}"
	reader.condition[0].expression == "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.state.name}/objects/plans/\")"
}

valid_federation if {
	owner := input.resource.google_project_iam_member.pipeline_owner[0]
	owner.for_each == "${var.repository_maintainer_ids}"
	owner.project == "${google_project.state.project_id}"
	owner.role == "roles/owner"
	owner.member == "principalSet://iam.googleapis.com/${var.wif_pool}/attribute.main_branch_repository_actor_id/${var.repository_id}_${each.value}"
}

deny contains "GCP module must contain only project, storage and scoped IAM resources" if not valid_inventory

deny contains "State must retain private versioned storage, deletion guards and prefix-scoped plan cleanup" if not valid_state

deny contains "Storage audit logs must cover admin reads, data reads and writes without exemptions" if not valid_audit_logging

deny contains "Plan readers must have read-only access limited to the plans prefix" if not valid_readers

deny contains "Project administration must retain main/repository/actor-scoped federation" if not valid_federation
