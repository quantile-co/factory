# Secrets stay in runtime authentication, never persistent inputs or Nix values.
provider "github" {
  owner = "quantile-co"
}

provider "google" {}

# Hindsight credentials remain separate from the GitHub REST_API_BEARER.
provider "restful" {
  alias    = "hindsight"
  base_url = "https://api.hindsight.vectorize.io"
  security = { http = { token = { token = var.hindsight_api_token } } }
}

# The workflow CLI maps GH_REPO_TOKEN to both providers' native token variables.
# Direct OpenTofu procedures must supply both; neither belongs in state.
provider "restapi" {
  uri = "https://api.github.com"

  headers = {
    Accept               = "application/vnd.github+json"
    X-GitHub-Api-Version = "2022-11-28"
  }
}
