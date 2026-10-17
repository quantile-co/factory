terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "= 6.13.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "8.7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.1"
    }
    # This registry supplies Mastercard's release signing key.
    restapi = {
      source  = "registry.terraform.io/Mastercard/restapi"
      version = "= 3.0.0"
    }
  }
}
