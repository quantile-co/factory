---
name: day-zero-deploy
description: Plan a clean rebuild in Terraform-root dependency order. Bootstrap genuinely new installations, migrate local state to GCS, hand off to protected saved-plan workflows, and remove the bootstrap operator's direct Owner grant. Never reseed an existing installation.
---

# Day Zero

For a Namespace profile request only, use the [profile procedure below](#namespace-runner-profiles-only-if-required) and stop there.
For a new Terraform installation, read [the full bootstrap procedure](references/local-state.md) before acting. Work from the consuming repository root in its pinned direnv shell.
Read `AGENTS.md`, `.pi/memory/MEMORY.md`, the current Terraform root, its
pinned Factory module sources, the consumer's shell and task scripts, and production workflow callers
**and** called workflows. Set local `TF_DIR` from the repository task/app's mapping
of the workflow's logical `--tf-layer`. Do not substitute unverified bootstrap instructions
or assume a local checkout without state is a fresh installation.

Confirm the target and inventory existing resources and local/remote state
first. For an existing installation use [deploy](../deploy/SKILL.md). Execute
only an explicitly approved phase. Each credential operation, import, Apply,
state migration, IAM change, workflow dispatch or retry needs separate approval.
The code examples are a phase-by-phase procedure, not permission to run all of
them end-to-end or evidence that every consumer has been bootstrapped.

Review and, for the new installation, adjust the concrete root's source-owned
repository identity, billing account, parent folder, bucket location and paired
owner/member records before seeding. Confirm the values and identity pairings;
runtime variables do not override them. Keep existing installations unchanged
unless a separately reviewed resource or access change is intended. Supply
verified `GH_REPO`, WIF and the provider token from approved runtime sources. Never hardcode a Factory
repository identity into consumer source or expose token values through Nix,
Terraform inputs, Git or public logs. Preserve WIF, locks, backups and recovery
access. After CI handoff remove only the bootstrap human's direct Owner grant,
never standing creator/billing, CI or recovery grants.

## Derive the rebuild order before seeding

**Confirm the rebuild scope first.** If the operator hasn't specified what to rebuild, ask.
For one repository or a named set, inspect only those repositories. For a GitHub
organization, enumerate all repositories visible to the current identity, identify
which deploy Terraform roots, and show that inventory to the operator for confirmation.
Flag any gaps in visibility; local checkouts are not an organization inventory.
Treat dependencies outside the confirmed scope as external prerequisites unless
the operator explicitly expands the scope.

1. **Inventory roots, not repositories or modules.** For each installation in scope, trace its workflow layer to its actual root directory and backend identity. Distinguish surviving resources/state (recover them) from confirmed new installations. List external prerequisites such as the parent folder, billing, identity provider and operator access.
2. **Trace each input to its producer.** Read root code, build/release commands and deployment checks. Record `producer → consumer` for outputs and for dependencies Terraform cannot see: a fresh DNS claim, a published image digest, a populated secret version or a certificate becoming ready. Record how to verify each handoff, not secret values. A literal copied from the old installation is not evidence the input exists in the new one.
3. **Check the root boundaries.** An infrastructure root should be able to create its foundation without a release: for example, a project, registry and runtime identity. An application root consumes that foundation and an immutable release. A single infrastructure root is enough when there is no separately deployed workload. If one root must create a registry and also deploy an image that can only be published afterwards, show the cycle and stop for a root split; `-target` or a placeholder release is not a rebuild order.
4. **Topologically sort.** List the roots and intervening checkpoints with no unmet prerequisites as the first wave. Mark those as satisfied on paper, then repeat. If anything remains and nothing is ready, report the missing external input or the exact dependency cycle. Don't prescribe a universal repository order.
5. **Present the Day Zero checklist for review:** for each wave, give the root path or checkpoint, what it needs, what it produces and how readiness is verified. During an authorized rebuild, advance only on verified outputs; independent roots may proceed in parallel. Use the local seed and migration only for a new foundation that creates its backend. Later roots use their own backend prefixes and protected workflows; an ordering is not approval to run them.

## Namespace runner profiles (only if required)

Skip this section unless the reviewed workflows use Namespace. Profiles belong to
**workspaces**, not repositories. This section can be used on its own: a missing
profile says nothing about Terraform state and never authorizes bootstrap.

1. From the operator's pinned shell, verify the workspace ID, connected GitHub
    organization, admin access and exact required `runs-on` labels. Inventory the
    workspace with `nsc --keychain "$workspace" workspace describe` and
    `nsc --keychain "$workspace" github profile list`. A failed or partial lookup
    is not absence. Stop on a mismatch or if the intended profile exists under
    another tag; do not create a duplicate to resolve a naming discrepancy.
2. If the required profiles exist, use them unchanged. Do not reconcile them
    against this example. For an explicitly requested customization, draft the
    exact diff against the current profile ID and version. Preserve access,
    network, cache and other settings. Do not round-trip an incomplete describe
    response into a full replacement spec. Get separate approval for the update.
3. Only for a **confirmed missing** profile, render one spec below. Verify the
    workspace's `quantile` Tailscale integration is already configured for
    nonprod enrollment and MagicDNS. Never put enrollment credentials in the
    image or spec. Use a **published**, reviewed Factory commit that exports
    `factory-github`. The examples correspond to
    `namespace-profile-quantile-4x8;tailscale.spec=quantile` and `namespace-profile-quantile-8x16;tailscale.spec=quantile`.
    Supply the approved access level for the workspace; never infer it from size.

```bash
set -euo pipefail
umask 077
: "${workspace:?verified nsc keychain}" "${FACTORY_REV:?published Factory commit}"
[[ $FACTORY_REV =~ ^[0-9a-f]{40}$ ]] || exit 1
case "${shape:?required runner size}" in 4x8|8x16) ;; *) exit 1 ;; esac
case "${access:?approved access level}" in
  ACCESS_LEVEL_RESTRICTED|ACCESS_LEVEL_LIMITED|ACCESS_LEVEL_PERMISSIVE) ;;
  *) exit 1 ;;
esac
review=$(mktemp -d)
spec="$review/quantile-$shape.json"
image=$(cat <<EOF
ARG NAMESPACE_BASE_IMAGE_REF
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS node24
FROM nixos/nix:2.28.3@sha256:e623d73af9cac82d1b50784c83e0cf2a4b83bfd2cfe8d5b67809a2fc94e043ac AS factory
RUN nix --extra-experimental-features 'nix-command flakes' build 'github:quantile-co/factory/$FACTORY_REV#factory-github' --out-link /result && cp -a /result/. /runtime
FROM \${NAMESPACE_BASE_IMAGE_REF}
COPY --from=node24 /usr/local/bin/node /usr/local/bin/node
COPY --from=factory /runtime/ /opt/factory-github/
ENV ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/factory-github/bin/job-started.sh
ENV ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/factory-github/bin/job-completed.sh
USER root
RUN node --version && node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)' && /opt/factory-github/bin/factory-github runner install
USER runner
EOF
)
jq -n --arg image "$image" --arg shape "$shape" --arg access "$access" \
  --argjson cpu "${shape%x*}" --argjson ram "${shape#*x}" '{
    tag: ("quantile-" + $shape), os: "ubuntu-24.04", access_level: $access,
    instance_shape: {os: "linux", machine_arch: "amd64", virtual_cpu: $cpu,
                      memory_megabytes: ($ram * 1024)},
    builder_mode: "NO_CACHING", swap_size_mb: 0,
    cache_volume_settings: [{volume_tag: "nix", volume_size_gb: 20,
                              allow_commit_from_branch: ["main"]}],
    custom_runner_image_spec: {docker_spec: {dockerfile_content: $image}}
  }' > "$spec"
printf 'Workspace keychain: %s\n' "$workspace"
jq . "$spec"
jq -r '.custom_runner_image_spec.docker_spec.dockerfile_content' "$spec"
sha256sum "$spec"
```

Stop for review. Show the operator the verified workspace ID, tag, shape,
access settings, full payload, rendered Dockerfile and spec digest. If the
workspace needs different settings, revise the draft **before** approval. Preserve the Namespace base,
final `runner` user, immutable Factory revision and absolute hook paths.
Do not include secrets or depend on a job checkout.

Only after explicit approval of that workspace and exact digest, recheck the
profile is still absent, verify the unchanged spec, then submit that file:

```bash
printf '%s  %s\n' "${APPROVED_SHA256:?operator-reviewed digest}" "$spec" | sha256sum --check --status || exit 1
nsc --keychain "$workspace" github profile create --spec_file "$spec"
```

Read back the profile and wait for its runner image to be ready. On an approved
smoke job using the workflow label above, with no setup action, verify a
private inference request, receipt of a test trace, and collector health on
`127.0.0.1:13133`. Check the completion
hook stops the collector. Investigate a failed or ambiguous create; do not retry
blindly or create a second profile.
