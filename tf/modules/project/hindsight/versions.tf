terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    restapi = {
      source  = "registry.terraform.io/Mastercard/restapi"
      version = "= 3.0.0"
    }
  }
}
