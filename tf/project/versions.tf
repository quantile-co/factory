terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = ">= 6.13.0, < 7.0.0"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 8.4.0, < 8.5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.9.1, < 4.0.0"
    }
  }
}
