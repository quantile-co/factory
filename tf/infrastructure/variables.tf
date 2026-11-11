variable "hindsight_api_token" {
  description = "Runtime-only Hindsight provider credential, resupplied for each Plan and Apply."
  type        = string
  sensitive   = true
  ephemeral   = true
  nullable    = false

  validation {
    condition     = length(trimspace(var.hindsight_api_token)) > 0
    error_message = "Supply the approved HINDSIGHT_API_TOKEN runtime credential."
  }
}

variable "gcp_wif_pool" {
  description = "Existing, trusted GitHub WIF pool resource path supplied by Q0."
  type        = string
  nullable    = false
}
