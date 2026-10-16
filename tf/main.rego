package terraform.repository

import rego.v1

valid_root if {
	input == {"module": {"project": [{
		"source": "./project",
		"gh_repository_name": "factory",
		"gh_description": "Quantile software factory.",
		"gh_visibility": "public",
		"gh_maintainers": "${var.gh_maintainers}",
		"gcp_project_prefix": "factory",
		"gcp_folder_id": "${var.gcp_folder_id}",
		"gcp_billing_account": "${var.gcp_billing_account}",
		"gcp_tf_state_location": "${var.gcp_tf_state_location}",
		"gcp_wif_pool": "${var.gcp_wif_pool}",
	}]}}
}

deny contains "Repository root must call only the reviewed factory project module" if not valid_root
