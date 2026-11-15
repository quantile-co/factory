terraform {
  required_version = ">= 1.12.3, < 2.0.0"

  required_providers {
    restful = {
      source  = "registry.terraform.io/magodo/restful"
      version = "= 0.25.2"
    }
  }
}
