# Secrets stay in runtime authentication, not Terraform variables or Nix values.
provider "github" {
  owner = "quantile-co"
}

provider "google" {}

# REST_API_BEARER supplies the same runtime credential as GITHUB_TOKEN. Set both
# for local Plan/Apply; neither credential belongs in resource data or state.
provider "restapi" {
  uri = "https://api.github.com"

  headers = {
    Accept               = "application/vnd.github+json"
    X-GitHub-Api-Version = "2022-11-28"
  }
}
