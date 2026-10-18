terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = ">= 6.13.0, < 7.0.0"
    }
    restapi = {
      source  = "registry.terraform.io/Mastercard/restapi"
      version = ">= 3.0.0, < 4.0.0"
    }
  }
}
