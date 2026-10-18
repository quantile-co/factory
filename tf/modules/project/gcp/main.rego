package terraform.project.gcp

import rego.v1

valid_inventory if {
	object.keys(input) == {"resource"}
	object.keys(input.resource) == {
		"random_id", "google_project", "google_project_service", "google_storage_bucket",
		"google_project_iam_member", "google_storage_bucket_iam_member",
	}
	every resources in input.resource {
		count(resources) == 1
		every declarations in resources {
			count(declarations) == 1
		}
	}
}

valid_state if {
	input.resource.random_id.state == [{"byte_length": 2}]
	input.resource.google_project.state == [{
		"name": "${var.project_prefix}-${random_id.state.hex}",
		"project_id": "${var.project_prefix}-${random_id.state.hex}",
		"folder_id": "${var.folder_id}",
		"billing_account": "${var.billing_account}",
		"auto_create_network": false,
		"deletion_policy": "PREVENT",
		"lifecycle": [{"prevent_destroy": true}],
	}]
	input.resource.google_project_service.storage == [{"project": "${google_project.state.project_id}", "service": "storage.googleapis.com", "disable_on_destroy": false}]
	input.resource.google_storage_bucket.state == [{
		"depends_on": ["${google_project_service.storage}"],
		"project": "${google_project.state.project_id}",
		"name": "${google_project.state.project_id}-tf-state",
		"location": "${var.tf_state_location}",
		"force_destroy": false,
		"uniform_bucket_level_access": true,
		"public_access_prevention": "enforced",
		"versioning": [{"enabled": true}],
		"lifecycle_rule": [
			{"action": [{"type": "Delete"}], "condition": [{"days_since_noncurrent_time": 90}]},
			{"action": [{"type": "Delete"}], "condition": [{"age": 1, "matches_prefix": ["plans/"]}]},
			{"action": [{"type": "Delete"}], "condition": [{"days_since_noncurrent_time": 1, "matches_prefix": ["plans/"]}]},
		],
		"lifecycle": [{"prevent_destroy": true}],
	}]
	input.resource.google_storage_bucket_iam_member.plan_reader == [{
		"for_each": "${var.maintainers}",
		"bucket": "${google_storage_bucket.state.name}",
		"role": "roles/storage.objectViewer",
		"member": "user:${each.value}",
		"condition": [{
			"title": "read-saved-plans",
			"expression": "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.state.name}/objects/plans/\")",
		}],
	}]
	input.resource.google_project_iam_member.pipeline_owner == [{
		"for_each": "${var.repository_maintainer_ids}",
		"project": "${google_project.state.project_id}",
		"role": "roles/owner",
		"member": "principalSet://iam.googleapis.com/${var.wif_pool}/attribute.main_branch_repository_actor_id/${var.repository_id}_${each.value}",
	}]
}

deny contains "GCP module must contain only project, storage and scoped IAM resources" if not valid_inventory

deny contains "State must retain private versioned storage, plan-only readers and main/repository/actor-scoped federation" if not valid_state
