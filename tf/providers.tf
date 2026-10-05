# Secrets stay in runtime authentication, not Terraform variables or Nix values.
provider "github" {
  owner = "quantile-co"
}

provider "google" {}
