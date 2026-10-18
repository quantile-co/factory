package terraform.infrastructure

import rego.v1

valid_root if {
	input == {"module": {
		"github": [{
			"source": "../modules/project/github",
			"repository_name": "factory",
			"description": "Quantile software factory.",
			"visibility": "public",
			"maintainers": "${var.gh_maintainers}",
		}],
		"gcp": [{
			"source": "../modules/project/gcp",
			"project_prefix": "factory",
			"folder_id": "${var.gcp_folder_id}",
			"maintainers": "${var.gcp_maintainers}",
			"billing_account": "${var.gcp_billing_account}",
			"tf_state_location": "${var.gcp_tf_state_location}",
			"wif_pool": "${var.gcp_wif_pool}",
			"repository_id": "${module.github.repository_id}",
			"repository_maintainer_ids": "${module.github.maintainer_ids}",
		}],
	}}
}

deny contains "Infrastructure root must compose the GitHub and GCP project modules with explicit identities" if not valid_root
