locals {
  project_owners = [{
    gcp_email   = "aj@quantile.co"
    gh_username = "aj-welch"
  }]
  project_members = []

  hindsight_pages = {
    hindsight_rollout = {
      name         = "Parallel Hindsight rollout coordination"
      parent_id    = "kf-d8f8581471bf4e229bb04f03fc8e0f74"
      tags         = ["knowledge:feature-work"]
      source_query = <<-EOT
        Summarize only Factory's Hindsight rollout and maintenance: the chosen memory
        architecture, repository isolation, native Pi configuration, migration and
        verification decisions, and unresolved rollout work. Distinguish decisions,
        proposals, assistant claims and evidenced outcomes; give dates and source
        references where available. Treat old status as historical, not current.
        Mention other repositories only where they directly constrain this rollout.
        Exclude observability/Amp implementation details, unrelated tasks, repeated
        chronology and credentials. Keep the answer concise and say what is unknown.
      EOT
    }
    observability = {
      name         = "Full-fidelity ClickHouse Observability"
      parent_id    = "kf-d8f8581471bf4e229bb04f03fc8e0f74"
      tags         = ["knowledge:feature-work"]
      source_query = <<-EOT
        Summarize only Factory's full-fidelity ClickHouse observability initiative:
        approved scope, architecture and rationale, evidence of delivery/verification,
        and unresolved gaps. Distinguish confirmed decisions, proposals, agent claims
        and evidenced outcomes; include dates and source references where available.
        Mention consumer repositories only for directly relevant integration boundaries.
        Exclude memory-rollout work, unrelated Amp adoption, repeated chronology,
        credentials and raw telemetry payloads. Mark superseded designs and do not
        present historical status as current. Keep the answer concise.
      EOT
    }
    amp_adoption = {
      name         = "Amp consumer source adoption"
      parent_id    = "kf-d8f8581471bf4e229bb04f03fc8e0f74"
      tags         = ["knowledge:feature-work"]
      source_query = <<-EOT
        Summarize only Factory's Amp consumer adoption initiative: approved integration
        decisions and rationale, consumer requirements, completed qualifications with
        supporting evidence, and outstanding qualifications. Distinguish decisions,
        proposals and agent claims; include dates and source references where available.
        Mention other repositories only for relevant consumer boundaries and obligations.
        Exclude Hindsight migration, unrelated observability implementation, duplicate
        chronology and credentials. Mark superseded approaches and avoid unsupported
        claims about present deployment status. Keep the answer concise.
      EOT
    }
  }
}

# One module owns repository settings; GCP projects reuse its identity outputs.
# This repository is intentionally public; scope the scanner exception to this call.
# trivy:ignore:AVD-GIT-0001
module "gh" {
  source = "../modules/project/github"

  repo_name    = "factory"
  description  = "Quantile software factory."
  visibility   = "public"
  environments = ["prod"]
  owners       = [for person in local.project_owners : person.gh_username]
  members      = [for person in local.project_members : person.gh_username]

  factory_automatic_label = true
}

# Adopt the existing pilot label; do not create a duplicate or manage other labels.
import {
  to = module.gh.github_issue_label.self["factory-automatic"]
  id = "factory:factory-automatic"
}

module "gcp" {
  source = "../modules/project/gcp"

  project_prefix    = "factory"
  folder_id         = "145094075590"
  owners            = [for person in local.project_owners : person.gcp_email]
  members           = [for person in local.project_members : person.gcp_email]
  billing_account   = "0120D4-52D1E2-9C3D0D"
  tf_state_location = "US"
  wif_pool          = var.gcp_wif_pool

  gh_repo_id   = module.gh.repo_id
  gh_owner_ids = module.gh.owner_ids
}

module "hindsight" {
  source = "../modules/project/hindsight"
  providers = {
    restful = restful.hindsight
  }

  bank_id          = "quantile-co--factory"
  name             = "quantile-co/factory"
  additional_pages = local.hindsight_pages
}

# One-time state transition. Remove after the approved saved-plan Apply.
# Forget the former provider binding without deleting the bank or its memories.
removed {
  from = module.hindsight.restapi_object.bank

  lifecycle {
    destroy = false
  }
}

import {
  to = module.hindsight.restful_resource.bank
  id = jsonencode({
    id                     = "/v1/default/banks"
    path                   = "/v1/default/banks/quantile-co--factory"
    query                  = { q = ["quantile-co--factory"], limit = ["1000"] }
    read_selector          = "[banks.#.{\"bank_id\":bank_id,\"name\":name}]|@flatten|{\"bank\":#(bank_id==\"quantile-co--factory\")}"
    read_response_template = "$(body.bank)"
    body                   = { name = null }
  })
}

import {
  for_each = {
    hindsight_rollout = "kp-6f1cf1480f174a2dac9eb858a451ed3f"
    observability     = "kp-f4a6421ef7394c5f89ca2f58252153ac"
    amp_adoption      = "kp-0ae8265cdb704fa488714078b2751102"
  }
  to = module.hindsight.restful_resource.page[each.key]
  id = jsonencode({
    id                     = "/v1/default/banks/quantile-co--factory/pages/tree"
    path                   = "/v1/default/banks/quantile-co--factory/pages"
    read_selector          = "[roots.#(id==\"kf-d8f8581471bf4e229bb04f03fc8e0f74\").children.#.{\"page_id\":id,\"name\":name,\"source_query\":description,\"parent_id\":parent_id,\"tags\":tags,\"trigger\":trigger.{\"refresh_cron\":refresh_cron}}]|@flatten|{\"page\":#(page_id==${jsonencode(each.value)})}"
    read_response_template = "$(body.page)"
    body = {
      name         = null
      source_query = null
      parent_id    = null
      tags         = null
      trigger      = { refresh_cron = null }
    }
  })
}
