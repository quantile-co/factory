variable "gcp_wif_pool" {
  description = "Existing, trusted GitHub WIF pool resource path supplied by Q0."
  type        = string
  nullable    = false
}

variable "project_owners" {
  description = "Paired identities for existing plan readers and protected deployment actors."
  type = list(object({
    gcp_email   = string
    gh_username = string
  }))
  nullable = false

  validation {
    condition     = length(var.project_owners) > 0
    error_message = "Supply at least one project owner."
  }

  validation {
    condition = alltrue([for person in concat(var.project_owners, var.project_members) :
      can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", person.gcp_email)) &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9-]{0,38}$", person.gh_username))
    ])
    error_message = "Each owner and member needs a Google account email and GitHub username."
  }

  validation {
    condition = (
      length(distinct([for person in concat(var.project_owners, var.project_members) : try(lower(person.gcp_email), "")])) == length(var.project_owners) + length(var.project_members) &&
      length(distinct([for person in concat(var.project_owners, var.project_members) : try(lower(person.gh_username), "")])) == length(var.project_owners) + length(var.project_members)
    )
    error_message = "Each email and GitHub username must occur once across owners and members, ignoring case."
  }
}

variable "project_members" {
  description = "Paired repository writers; no protected deployment eligibility or GCP access."
  type = list(object({
    gcp_email   = string
    gh_username = string
  }))
  default  = []
  nullable = false
}
