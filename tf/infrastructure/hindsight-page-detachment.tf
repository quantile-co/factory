# One-time, state-only handoff of the two ordinary initiative pages back to Pi.
# OpenTofu removed blocks cannot name individual for_each instances. Move each
# to its own address, then forget it in the same protected Apply. Keep this file
# until that Apply is verified; no Hindsight page should be deleted or recreated.
moved {
  from = module.hindsight.restful_resource.page["amp_adoption"]
  to   = module.hindsight.restful_resource.detached_amp_adoption
}

removed {
  from = module.hindsight.restful_resource.detached_amp_adoption

  lifecycle {
    destroy = false
  }
}

moved {
  from = module.hindsight.restful_resource.page["hindsight_rollout"]
  to   = module.hindsight.restful_resource.detached_hindsight_rollout
}

removed {
  from = module.hindsight.restful_resource.detached_hindsight_rollout

  lifecycle {
    destroy = false
  }
}
