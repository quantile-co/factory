# Terraform owns bank identity and page definitions, never generated memory,
# extraction strategies or credentials.
locals {
  bank_path  = "/v1/default/banks/${var.bank_id}"
  pages_path = "${local.bank_path}/pages"
  pages = merge({
    procedures = {
      name         = "Successful procedures and pitfalls"
      source_query = <<-EOT
        From this repository bank's recorded experience, summarize reusable procedures
        that have supporting outcomes. For each, give the conditions where it applies,
        the essential steps, failure modes or counterexamples, and source references
        and dates where available. Distinguish user decisions, assistant claims and
        independently evidenced outcomes. Explicitly mark superseded approaches and
        unresolved contradictions; never invent verification. Include only lessons
        applicable to this repository, not other repositories or dependency projects.
        Omit session chronology, transient rollout status, repeated restatements,
        credentials and raw payloads. Prefer a short useful guide over filling sections
        without evidence; say when the evidence is insufficient.
      EOT
      tags         = []
      parent_id    = null
    }
  }, var.additional_pages)

  # Build JSON projections with GJSON, not raw string templates: source questions
  # may contain quotes or newlines. Only owned configuration reaches state.
  page_projection = "{\"page_id\":id,\"name\":name,\"source_query\":description,\"parent_id\":parent_id,\"tags\":tags,\"trigger\":trigger.{\"refresh_cron\":refresh_cron}}"
}

resource "restful_resource" "bank" {
  path                   = local.bank_path
  create_method          = "PUT"
  read_path              = "/v1/default/banks"
  read_selector          = "[banks.#.{\"bank_id\":bank_id,\"name\":name}]|@flatten|{\"bank\":#(bank_id==${jsonencode(var.bank_id)})}"
  read_response_template = "$(body.bank)"
  update_path            = local.bank_path
  update_method          = "PATCH"
  delete_path            = local.bank_path
  query                  = { q = [var.bank_id], limit = ["1000"] }
  body                   = { name = var.name }
  output_attrs           = ["bank_id"]

  lifecycle {
    prevent_destroy = true

    postcondition {
      condition     = try(self.output.bank_id == var.bank_id, false)
      error_message = "The bank identity could not be verified; do not recreate or rename the bank."
    }
  }
}

# PATCH owns a single override. DELETE /config would reset the entire bank.
resource "restful_resource" "page_defaults" {
  path          = "${local.bank_path}/config"
  create_method = "PATCH"
  update_method = "PATCH"
  delete_method = "PATCH"
  delete_body   = { updates = {} }
  read_selector = "{\"updates\":config.{\"page_default_trigger\":page_default_trigger}}"
  body = {
    updates = { page_default_trigger = { refresh_after_consolidation = false } }
  }

  depends_on = [restful_resource.bank]

  lifecycle {
    prevent_destroy = true
  }
}

resource "restful_resource" "page" {
  for_each = local.pages

  path      = local.pages_path
  read_path = "${local.pages_path}/tree"
  read_selector = format(
    "[%s.#.%s]|@flatten|{\"page\":#(page_id==\"$(body.page_id)\")}",
    each.value.parent_id == null ? "roots" : "roots.#(id==${jsonencode(each.value.parent_id)}).children",
    local.page_projection,
  )
  # Requiring the selected object makes a missing/moved page a read error, not
  # an empty response or a replacement proposal. The object is already projected.
  read_response_template = "$(body.page)"
  update_path            = "${local.pages_path}/nodes/$(body.page_id)"
  update_method          = "PATCH"
  delete_path            = "${local.pages_path}/nodes/$(body.page_id)"
  body = {
    name         = each.value.name
    source_query = trimspace(each.value.source_query)
    parent_id    = each.value.parent_id
    tags         = tolist(each.value.tags)
    trigger      = { refresh_cron = var.refresh_cron }
  }
  output_attrs = ["page_id"]

  depends_on = [restful_resource.bank]

  lifecycle {
    prevent_destroy = true

    postcondition {
      condition     = can(regex("^kp-[a-zA-Z0-9-]+$", self.output.page_id))
      error_message = "The Hindsight page identity could not be verified in its expected folder; do not recreate it."
    }
  }
}
