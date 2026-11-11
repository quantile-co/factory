variable "bank_id" {
  description = "Immutable organization-qualified Hindsight bank ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*$", var.bank_id))
    error_message = "Use an explicit organization--repository bank ID, not a checkout basename."
  }
}

variable "name" {
  description = "Nonsecret display name for this repository's memory bank."
  type        = string

  validation {
    condition     = length(trimspace(var.name)) > 0
    error_message = "The bank display name must not be empty."
  }
}
