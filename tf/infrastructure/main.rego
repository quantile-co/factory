package terraform.infrastructure

import rego.v1

# Check ownership and identity wiring, not descriptive configuration.
valid_root if {
	gh := input.module.gh[0]
	gcp := input.module.gcp[0]
	gh.source == "../modules/project/github"
	gh.owners == "${[for person in var.project_owners : person.gh_username]}"
	gh.members == "${[for person in var.project_members : person.gh_username]}"
	gcp.source == "../modules/project/gcp"
	gcp.owners == "${[for person in var.project_owners : person.gcp_email]}"
	gcp.members == "${[for person in var.project_members : person.gcp_email]}"
	gcp.wif_pool == "${var.gcp_wif_pool}"
	gcp.gh_repo_id == "${module.gh.repo_id}"
	gcp.gh_owner_ids == "${module.gh.owner_ids}"
}

deny contains "Infrastructure root must compose the GitHub and GCP project modules with explicit identities" if not valid_root
