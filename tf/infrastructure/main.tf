locals {
  project_owners = [{
    gcp_email   = "aj@quantile.co"
    gh_username = "aj-welch"
  }]
  project_members = []
}

# One module owns repository settings; GCP projects reuse its identity outputs.
# This repository is intentionally public; scope the scanner exception to this call.
# trivy:ignore:AVD-GIT-0001
module "gh" {
  source = "../modules/project/github"

  repo_name   = "factory"
  description = "Quantile software factory."
  visibility  = "public"
  owners      = [for person in local.project_owners : person.gh_username]
  members     = [for person in local.project_members : person.gh_username]
}

module "gcp" {
  source = "../modules/project/gcp"

  project_prefix    = "factory"
  folder_id         = "145094075590"
  owners            = [for person in local.project_owners : person.gcp_email]
  members           = [for person in local.project_members : person.gcp_email]
  billing_account   = "0120D4-52D1E2-9C3D0D"
  tf_state_location = "US"
  wif_pool          = var.gcp_wif_pool

  gh_repo_id   = module.gh.repo_id
  gh_owner_ids = module.gh.owner_ids
}
