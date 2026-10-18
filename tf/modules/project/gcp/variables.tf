variable "billing_account" {
  description = "Billing account for the project's infrastructure."
  type        = string
  nullable    = false
}

variable "folder_id" {
  description = "Numeric folder ID that directly parents the project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]+$", var.folder_id))
    error_message = "Use a numeric GCP folder ID, not a resource path."
  }
}

variable "maintainers" {
  description = "Google account emails allowed to read saved plans, not Terraform state."
  type        = set(string)
  nullable    = false
}

variable "project_prefix" {
  description = "Stable project ID prefix; a persistent random suffix is appended."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,23}$", var.project_prefix)) && !endswith(var.project_prefix, "-")
    error_message = "Use a 2–24 character lowercase project prefix not ending in a hyphen."
  }
}

variable "repository_id" {
  description = "Immutable numeric ID of the GitHub repository allowed to administer this project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]+$", var.repository_id))
    error_message = "Use a numeric GitHub repository ID."
  }
}

variable "repository_maintainer_ids" {
  description = "GitHub usernames mapped to immutable numeric actor IDs for main-branch WIF access."
  type        = map(string)
  nullable    = false

  validation {
    condition     = length(var.repository_maintainer_ids) > 0 && alltrue([for id in values(var.repository_maintainer_ids) : can(regex("^[0-9]+$", id))])
    error_message = "Supply at least one numeric GitHub actor ID."
  }
}

variable "tf_state_location" {
  description = "Location of the protected, versioned state bucket."
  type        = string
  default     = "US"
  nullable    = false
}

variable "wif_pool" {
  description = "Existing GitHub WIF pool with the main_branch_repository_actor_id mapping."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/[0-9]+/locations/global/workloadIdentityPools/[a-z0-9-]+$", var.wif_pool))
    error_message = "Supply a full WIF pool path with a main-branch actor mapping."
  }
}
