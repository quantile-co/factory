variable "additional_pages" {
  description = "Repository-specific page definitions, at the root or in an existing top-level folder. Page identities are managed in Terraform state."
  type = map(object({
    name         = string
    source_query = string
    tags         = optional(list(string), [])
    parent_id    = optional(string)
  }))
  default = {}

  validation {
    condition = !contains(keys(var.additional_pages), "procedures") && alltrue([
      for page in values(var.additional_pages) :
      length(trimspace(page.name)) > 0 && length(trimspace(page.source_query)) > 0 &&
      (page.parent_id == null ? true : can(regex("^kf-[a-zA-Z0-9-]+$", page.parent_id)))
    ])
    error_message = "Provide nonempty page names/questions, valid optional kf- folder IDs, and do not override the reserved procedures page."
  }
}

variable "bank_id" {
  description = "Immutable organization-qualified Hindsight bank ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*$", var.bank_id))
    error_message = "Use an explicit organization--repository bank ID, not a checkout basename."
  }
}

variable "refresh_cron" {
  description = "Five-field UTC schedule for managed pages; the server skips refreshes with no new in-scope memories. Native cron only, without client-side H expansion."
  type        = string
  default     = "0 3 * * *"

  validation {
    condition     = can(regex("^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$", var.refresh_cron))
    error_message = "Use a five-field numeric UTC cron expression, such as 0 3 * * *."
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
