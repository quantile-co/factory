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

variable "members" {
  description = "Member emails for the project roster; membership grants no GCP access."
  type        = set(string)
  default     = []
  nullable    = false

  validation {
    condition = alltrue([for email in var.members :
      !contains([for owner in var.owners : lower(owner)], lower(email))
    ])
    error_message = "Member emails must be distinct from owners, ignoring case."
  }
}

variable "owners" {
  description = "Project owner emails allowed to read saved plans, not Terraform state; no direct project Owner grant."
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

variable "gh_repo_id" {
  description = "Immutable numeric ID of the GitHub repository allowed to administer this project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]+$", var.gh_repo_id))
    error_message = "Use a numeric GitHub repository ID."
  }
}

variable "gh_owner_ids" {
  description = "GitHub usernames mapped to immutable numeric actor IDs for main-branch WIF access."
  type        = map(string)
  nullable    = false

  validation {
    condition     = length(var.gh_owner_ids) > 0 && alltrue([for id in values(var.gh_owner_ids) : can(regex("^[0-9]+$", id))])
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
