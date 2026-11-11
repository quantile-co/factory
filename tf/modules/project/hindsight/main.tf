# Only bank identity is infrastructure. Memory, extraction strategies and credentials
# remain outside Terraform; resetting bank config would erase client-owned overrides.
resource "restapi_object" "bank" {
  path          = "/v1/default/banks"
  object_id     = var.bank_id
  id_attribute  = "bank_id"
  create_path   = "/v1/default/banks/{id}"
  create_method = "PUT"
  read_path     = "/v1/default/banks"
  update_path   = "/v1/default/banks/{id}"
  update_method = "PATCH"
  destroy_path  = "/v1/default/banks/{id}"

  # Cloud removed /profile. Select the exact bank from the filtered listing instead.
  read_search = {
    results_key  = "banks"
    search_key   = "bank_id"
    search_value = var.bank_id
    query_string = "q=${urlencode(var.bank_id)}&limit=1000"
    # Strip the documented BankListItem metadata, including optional fields.
    # 3.0.0's ignore_server_additions also masks drift in managed fields; its
    # patch library cannot move/copy to the document root to project a whitelist.
    search_patch = jsonencode(flatten([
      for field in [
        "bank_id", "disposition", "mission", "created_at", "updated_at",
        "fact_count", "last_document_at", "last_write_at", "display_alias", "matched_aliases",
        ] : [
        { op = "add", path = "/${field}", value = null },
        { op = "remove", path = "/${field}" },
      ]
    ]))
  }

  data = jsonencode({ name = var.name })

  lifecycle {
    prevent_destroy = true

    # Provider 3.0.0 clears the ID on *any* read_search error, including 401/5xx.
    # Fail closed rather than treating a failed read as permission to create a bank.
    # This also refuses identity changes: migrate banks explicitly, never rename IDs.
    postcondition {
      condition     = self.id == var.bank_id
      error_message = "The bank identity could not be verified. Check API access and bank identity; do not recreate or rename the bank."
    }

    postcondition {
      condition     = toset(keys(self.api_data)) == toset(["name"])
      error_message = "The bank response schema changed. Review the API contract before applying; never manage server metadata as bank configuration."
    }
  }
}
