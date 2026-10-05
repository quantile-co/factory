# An existing repository must be imported rather than recreated. Infrastructure
# for its protected state lives in the reusable module; auth/backend stay here.
module "project" {
  source = "./project"

  gh_repository_name = "factory"
  gh_description     = "Quantile software factory: shared development and infrastructure modules."
  gh_visibility      = "public"
  gh_maintainers     = var.gh_maintainers

  gcp_project_prefix    = "factory"
  gcp_folder_id         = var.gcp_folder_id
  gcp_billing_account   = var.gcp_billing_account
  gcp_tf_state_location = var.gcp_tf_state_location
  gcp_wif_pool          = var.gcp_wif_pool
}
