package terraform.infrastructure

import rego.v1

# Check ownership and identity wiring, not descriptive configuration.
valid_root if {
	github := input.module.github[0]
	gcp := input.module.gcp[0]
	github.source == "../modules/project/github"
	github.maintainers == "${var.gh_maintainers}"
	gcp.source == "../modules/project/gcp"
	gcp.maintainers == "${var.gcp_maintainers}"
	gcp.wif_pool == "${var.gcp_wif_pool}"
	gcp.repository_id == "${module.github.repository_id}"
	gcp.repository_maintainer_ids == "${module.github.maintainer_ids}"
}

deny contains "Infrastructure root must compose the GitHub and GCP project modules with explicit identities" if not valid_root
