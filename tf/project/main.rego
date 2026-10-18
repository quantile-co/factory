package terraform.project

import rego.v1

valid_inventory if {
	object.keys(input) == {"resource", "data"}
	object.keys(input.resource) == {
		"github_repository", "github_branch_protection", "github_actions_repository_permissions", "restapi_object",
		"github_repository_vulnerability_alerts", "github_repository_dependabot_security_updates",
		"github_repository_environment", "github_repository_environment_deployment_policy",
		"random_id", "google_project", "google_project_service", "google_storage_bucket",
		"google_project_iam_member",
	}
	every resources in input.resource {
		count(resources) == 1
		every declarations in resources {
			count(declarations) == 1
		}
	}
	input.data == {"github_user": {"maintainer": [{"for_each": "${var.gh_maintainers}", "username": "${each.value}"}]}}
}

valid_protection if {
	input.resource.github_branch_protection.main == [{
		"repository_id": "${github_repository.self.node_id}",
		"pattern": "${var.gh_main_branch}",
		"enforce_admins": true,
		"allows_deletions": false,
		"allows_force_pushes": false,
		"force_push_bypassers": [],
		"required_linear_history": true,
		"require_signed_commits": true,
		"required_status_checks": [{"strict": true, "contexts": "${var.gh_required_checks}"}],
		"lifecycle": [{"prevent_destroy": true}],
	}]
}

valid_repository if {
	repository := input.resource.github_repository.self[0]
	repository.name == "${var.gh_repository_name}"
	repository.visibility == "${var.gh_visibility}"
	repository.archive_on_destroy == true
	repository.lifecycle == [{"prevent_destroy": true}]
	repository.allow_auto_merge == false
	repository.allow_merge_commit == false
	repository.allow_squash_merge == true
	repository.allow_rebase_merge == false
	repository.delete_branch_on_merge == true
	input.resource.github_actions_repository_permissions.self == [{"repository": "${github_repository.self.name}", "enabled": true, "allowed_actions": "selected", "sha_pinning_required": true}]
	input.resource.github_repository_vulnerability_alerts.self == [{"repository": "${github_repository.self.name}", "enabled": true}]
	input.resource.github_repository_dependabot_security_updates.self == [{"repository": "${github_repository.self.name}", "enabled": true, "depends_on": ["${github_repository_vulnerability_alerts.self}"]}]
	input.resource.github_repository_environment.main == [{
		"for_each": "${var.gh_environments}",
		"repository": "${github_repository.self.name}",
		"environment": "${each.value}",
		"deployment_branch_policy": [{"protected_branches": false, "custom_branch_policies": true}],
	}]
	input.resource.github_repository_environment_deployment_policy.main == [{
		"for_each": "${var.gh_environments}",
		"repository": "${github_repository.self.name}",
		"environment": "${github_repository_environment.main[each.key].environment}",
		"branch_pattern": "${var.gh_main_branch}",
	}]
}

valid_fork_approval if {
	input.resource.restapi_object.fork_workflow_approval == [{
		"depends_on": ["${github_actions_repository_permissions.self}"],
		"path": "/repos/${github_repository.self.full_name}/actions/permissions",
		"object_id": "fork-pr-contributor-approval",
		"create_path": "/repos/${github_repository.self.full_name}/actions/permissions/{id}",
		"create_method": "PUT",
		"destroy_method": "GET",
		"data": "${jsonencode({ approval_policy = \"all_external_contributors\" })}",
	}]
}

valid_state if {
	input.resource.random_id.state == [{"byte_length": 2}]
	input.resource.google_project.state == [{
		"name": "${var.gcp_project_prefix}-${random_id.state.hex}",
		"project_id": "${var.gcp_project_prefix}-${random_id.state.hex}",
		"folder_id": "${var.gcp_folder_id}",
		"billing_account": "${var.gcp_billing_account}",
		"auto_create_network": false,
		"deletion_policy": "PREVENT",
		"lifecycle": [{"prevent_destroy": true}],
	}]
	input.resource.google_project_service.storage == [{"project": "${google_project.state.project_id}", "service": "storage.googleapis.com", "disable_on_destroy": false}]
	input.resource.google_storage_bucket.state == [{
		"depends_on": ["${google_project_service.storage}"],
		"project": "${google_project.state.project_id}",
		"name": "${google_project.state.project_id}-tf-state",
		"location": "${var.gcp_tf_state_location}",
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
	input.resource.google_project_iam_member.pipeline_owner == [{
		"for_each": "${var.gh_maintainers}",
		"project": "${google_project.state.project_id}",
		"role": "roles/owner",
		"member": "principalSet://iam.googleapis.com/${var.gcp_wif_pool}/attribute.main_branch_repository_actor_id/${github_repository.self.repo_id}_${data.github_user.maintainer[each.key].id}",
	}]
}

deny contains "Project module must contain only the reviewed repository and state resources" if not valid_inventory

deny contains "Protection must retain strict checks, signatures and non-destructive branch rules" if not valid_protection

deny contains "Repository must retain deletion guards, security updates, pinned actions and branch-only environments" if not valid_repository

deny contains "Fork workflow approval must require all external contributors and preserve the policy on removal" if not valid_fork_approval

deny contains "State must retain private versioned storage and main/repository/actor-scoped federation" if not valid_state
