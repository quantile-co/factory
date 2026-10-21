terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 8.4.0, < 8.8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.9.1, < 4.0.0"
    }
  }
}
