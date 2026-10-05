variable "gcp_billing_account" {
  description = "Authorized billing account for factory's dedicated state project."
  type        = string
  nullable    = false
}

variable "gcp_folder_id" {
  description = "Numeric quantile-co folder ID directly parenting factory's project."
  type        = string
  nullable    = false
}

variable "gcp_tf_state_location" {
  description = "Bucket location chosen at Day Zero; changing it replaces the bucket."
  type        = string
  default     = "US"
  nullable    = false
}

variable "gcp_wif_pool" {
  description = "Existing, trusted GitHub WIF pool resource path supplied by Q0."
  type        = string
  nullable    = false
}

variable "gh_maintainers" {
  description = "GitHub usernames trusted to run production Plan/Apply on main."
  type        = set(string)
  nullable    = false
}
