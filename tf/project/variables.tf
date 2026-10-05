variable "gcp_billing_account" {
  description = "Billing account for the repository's dedicated state project."
  type        = string
  nullable    = false
}

variable "gcp_folder_id" {
  description = "Numeric folder ID that directly parents the state project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]+$", var.gcp_folder_id))
    error_message = "Use a numeric GCP folder ID, not a resource path."
  }
}

variable "gcp_project_prefix" {
  description = "Stable project ID prefix; a persistent random suffix is appended."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,23}$", var.gcp_project_prefix)) && !endswith(var.gcp_project_prefix, "-")
    error_message = "Use a 2–24 character lowercase project prefix not ending in a hyphen."
  }
}

variable "gcp_tf_state_location" {
  description = "Location of the protected, versioned state bucket."
  type        = string
  default     = "US"
  nullable    = false
}

variable "gcp_wif_pool" {
  description = "Existing GitHub WIF pool with the main_branch_repository_actor_id mapping."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^projects/[0-9]+/locations/global/workloadIdentityPools/[a-z0-9-]+$", var.gcp_wif_pool)) && var.gh_main_branch == "main"
    error_message = "Supply a full WIF pool path with a main-branch actor mapping."
  }
}

variable "gh_description" {
  description = "Public description of this repository."
  type        = string
  default     = ""
  nullable    = false
}

variable "gh_environments" {
  description = "Environments restricted to the existing main branch."
  type        = set(string)
  default     = ["non-prod", "prod"]
  nullable    = false
}

variable "gh_has_issues" {
  description = "Whether to enable the repository issue tracker."
  type        = bool
  default     = true
  nullable    = false
}

variable "gh_main_branch" {
  description = "Existing branch to protect and permit in environments."
  type        = string
  default     = "main"
  nullable    = false
}

variable "gh_maintainers" {
  description = "GitHub usernames whose main-branch runs may administer the project through WIF."
  type        = set(string)
  nullable    = false

  validation {
    condition     = length(var.gh_maintainers) > 0 && alltrue([for name in var.gh_maintainers : can(regex("^[A-Za-z0-9][A-Za-z0-9-]*$", name))])
    error_message = "Supply at least one valid GitHub maintainer username."
  }
}

variable "gh_repository_name" {
  description = "Repository name without its owner; the caller configures the provider owner."
  type        = string
  nullable    = false
}

variable "gh_required_checks" {
  description = "Exact required check contexts emitted by the caller's workflows."
  type        = set(string)
  default     = ["All"]
  nullable    = false
}

variable "gh_visibility" {
  description = "Repository visibility chosen by the caller."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["public", "private", "internal"], var.gh_visibility)
    error_message = "Use public, private, or internal."
  }
}
