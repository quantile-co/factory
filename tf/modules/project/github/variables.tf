variable "description" {
  description = "Public description of this repository."
  type        = string
  default     = ""
  nullable    = false
}

variable "environments" {
  description = "Environments restricted to the existing main branch."
  type        = set(string)
  default     = ["non-prod", "prod"]
  nullable    = false
}

variable "has_issues" {
  description = "Whether to enable the repository issue tracker."
  type        = bool
  default     = true
  nullable    = false
}

variable "main_branch" {
  description = "Existing branch to protect and permit in environments."
  type        = string
  default     = "main"
  nullable    = false
}

variable "maintainers" {
  description = "GitHub usernames whose immutable IDs are available for caller-managed access."
  type        = set(string)
  nullable    = false

  validation {
    condition     = length(var.maintainers) > 0 && alltrue([for name in var.maintainers : can(regex("^[A-Za-z0-9][A-Za-z0-9-]*$", name))])
    error_message = "Supply at least one valid GitHub maintainer username."
  }
}

variable "repository_name" {
  description = "Repository name without its owner; the caller configures the provider owner."
  type        = string
  nullable    = false
}

variable "required_checks" {
  description = "Exact required check contexts emitted by the caller's workflows."
  type        = set(string)
  default     = ["All"]
  nullable    = false
}

variable "visibility" {
  description = "Repository visibility chosen by the caller."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["public", "private", "internal"], var.visibility)
    error_message = "Use public, private, or internal."
  }
}
