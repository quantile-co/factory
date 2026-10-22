package terraform.project.github

import rego.v1

# New resource kinds or additional declarations need an ownership/security review.
valid_inventory if {
	object.keys(input.resource) == {
		"github_repository", "github_branch_protection", "github_actions_repository_permissions", "restapi_object",
		"github_repository_vulnerability_alerts", "github_repository_dependabot_security_updates",
		"github_repository_environment", "github_repository_environment_deployment_policy",
	}
	every resources in input.resource {
		count(resources) == 1
		every declarations in resources {
			count(declarations) == 1
		}
	}
	maintainer := input.data.github_user.maintainer[0]
	maintainer.for_each == "${var.maintainers}"
	maintainer.username == "${each.value}"
}

valid_protection if {
	branch := input.resource.github_branch_protection.main[0]
	branch.repository_id == "${github_repository.self.node_id}"
	branch.pattern == "${var.main_branch}"
	branch.enforce_admins == true
	branch.allows_deletions == false
	branch.allows_force_pushes == false
	branch.force_push_bypassers == []
	branch.required_linear_history == true
	branch.require_signed_commits == true
	branch.required_status_checks[0].strict == true
	branch.required_status_checks[0].contexts == "${var.required_checks}"
	branch.lifecycle[0].prevent_destroy == true
}

valid_repository if {
	repository := input.resource.github_repository.self[0]
	repository.archive_on_destroy == true
	repository.lifecycle[0].prevent_destroy == true
	actions := input.resource.github_actions_repository_permissions.self[0]
	actions.repository == "${github_repository.self.name}"
	actions.enabled == true
	actions.allowed_actions == "selected"
	actions.sha_pinning_required == true
	allowed := actions.allowed_actions_config[0]
	allowed.github_owned_allowed == true
	allowed.verified_allowed == true
	allowed.patterns_allowed == "${var.allowed_action_patterns}"
	alerts := input.resource.github_repository_vulnerability_alerts.self[0]
	alerts.repository == "${github_repository.self.name}"
	alerts.enabled == true
	updates := input.resource.github_repository_dependabot_security_updates.self[0]
	updates.repository == "${github_repository.self.name}"
	updates.enabled == true
}

valid_environments if {
	environment := input.resource.github_repository_environment.main[0]
	environment.for_each == "${var.environments}"
	environment.repository == "${github_repository.self.name}"
	environment.environment == "${each.value}"
	environment.deployment_branch_policy[0].protected_branches == false
	environment.deployment_branch_policy[0].custom_branch_policies == true
	policy := input.resource.github_repository_environment_deployment_policy.main[0]
	policy.for_each == "${var.environments}"
	policy.repository == "${github_repository.self.name}"
	policy.environment == "${github_repository_environment.main[each.key].environment}"
	policy.branch_pattern == "${var.main_branch}"
}

valid_fork_approval if {
	approval := input.resource.restapi_object.fork_workflow_approval[0]
	approval.count == "${var.visibility == \"public\" ? 1 : 0}"
	approval.path == "/repos/${github_repository.self.full_name}/actions/permissions"
	approval.object_id == "fork-pr-contributor-approval"
	approval.create_path == "/repos/${github_repository.self.full_name}/actions/permissions/{id}"
	approval.create_method == "PUT"
	approval.destroy_method == "GET"
	approval.data == "${jsonencode({ approval_policy = \"all_external_contributors\" })}"
}

deny contains "GitHub module must contain only repository resources and maintainer lookups" if not valid_inventory

deny contains "Protection must retain strict checks, signatures and non-destructive branch rules" if not valid_protection

deny contains "Repository must retain deletion guards, security updates and pinned actions" if not valid_repository

deny contains "Deployment environments must admit only the configured main branch" if not valid_environments

deny contains "Fork workflow approval must require all external contributors and preserve the policy on removal" if not valid_fork_approval
