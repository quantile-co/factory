# Secrets stay in runtime authentication, not Terraform variables or Nix values.
provider "github" {
  owner = "quantile-co"
}

provider "google" {}

# The workflow CLI maps GH_REPO_TOKEN to both providers' native token variables.
# Direct OpenTofu procedures must supply both; neither belongs in state.
provider "restapi" {
  uri = "https://api.github.com"

  headers = {
    Accept               = "application/vnd.github+json"
    X-GitHub-Api-Version = "2022-11-28"
  }
}
