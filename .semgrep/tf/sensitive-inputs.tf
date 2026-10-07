# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "missing" {
  type      = string
  sensitive = true
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "explicit_false" {
  type      = string
  sensitive = true
  ephemeral = false
}

# ok: terraform-sensitive-input-must-be-ephemeral
variable "protected" {
  sensitive = true
  ephemeral = true
}

# ok: terraform-sensitive-input-must-be-ephemeral
variable "reversed" {
  ephemeral = true
  type      = string
  sensitive = true
}

# ok: terraform-sensitive-input-must-be-ephemeral
variable "public" {
  type = string
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "comment_only" {
  sensitive = true
  # ephemeral = true
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "string_only" {
  sensitive = true
  description = "ephemeral = true"
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "heredoc_only" {
  sensitive = true
  description = <<-TEXT
  ephemeral = true
  TEXT
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "nested_validation" {
  sensitive = true
  validation {
    condition = length(var.nested_validation) > 0
    error_message = "Must be set"
  }
}

# ok: terraform-sensitive-input-must-be-ephemeral
output "sensitive_metadata" {
  sensitive = true
  value = "not an input declaration"
}

# ruleid: terraform-sensitive-input-must-be-ephemeral
variable "parenthesized_sensitive" {
  sensitive = (true)
}

# ok: terraform-sensitive-input-must-be-ephemeral
variable "parenthesized_ephemeral" {
  sensitive = true
  ephemeral = (true)
}
