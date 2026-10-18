# One module owns repository settings; GCP projects reuse its identity outputs.
# This repository is intentionally public; scope the scanner exception to this call.
# trivy:ignore:AVD-GIT-0001
module "github" {
  source = "../modules/project/github"

  repository_name = "factory"
  description     = "Quantile software factory."
  visibility      = "public"
  maintainers     = var.gh_maintainers
}

module "gcp" {
  source = "../modules/project/gcp"

  project_prefix    = "factory"
  folder_id         = var.gcp_folder_id
  maintainers       = var.gcp_maintainers
  billing_account   = var.gcp_billing_account
  tf_state_location = var.gcp_tf_state_location
  wif_pool          = var.gcp_wif_pool

  repository_id             = module.github.repository_id
  repository_maintainer_ids = module.github.maintainer_ids
}
