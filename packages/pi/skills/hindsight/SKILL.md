---
name: hindsight
description: Use Hindsight Cloud for repository memory, explicit imports/corrections/deletions, verification and pi-memory cutover. Never create a Markdown memory mirror.
---

# Hindsight repository memory

After verified cutover, Hindsight is persistent memory, not authorization or
current source truth. During migration, preserve existing memory until verified.
Use native Pi recall/retention and the upstream tools. Reflect only when needed.
Recall includes raw facts as well as observations, so new memories are searchable
before consolidation; the shared token cap remains 2,000.
After cutover, do not recreate MEMORY.md, daily logs, QMD memory collections or
memory commits.

## Runtime and credentials

Consumers select Factory's `hindsight.package`, `hindsight.shellHook`,
`hindsight.configFile` copied to `.pi/hindsight.json`, and
`hindsight.piSettingsFile` copied to `.pi/settings.json`.
Pi installs the pinned upstream npm package and loads its `dist/pi.js` directly;
Factory provides configuration, not a wrapper or alternate memory runtime.
Set an explicit organization-qualified `bankId`, identical across the repository's
worktrees/orbs. Start Pi in that checkout's development shell. Configuration
changes or switching repositories require restarting Pi. Do not use a basename
as bank identity. Install this skill through the existing canonical
`pnpm run skills:sync` workflow; Pi package skill discovery remains disabled.

Use one manually provisioned API key per developer, supplied locally as
`HINDSIGHT_API_TOKEN`. Its access must match the operator's existing grants; bank
restrictions can narrow access but do not require one key per repository.
Key provisioning stays manual: no OAuth bridge, custom login or child-key service.
Factory's checkout-local `HINDSIGHT_CONFIG` selects exactly one nonsecret file;
upstream does not also read a token from `~/.hindsight/coding-agent.json` in this
mode. Developers choose their private environment-loading mechanism.
Never commit the key, put it in Nix configuration/outputs or pass it on a command line.
The CLI uses different environment names: set `HINDSIGHT_API_URL` to
`https://api.hindsight.vectorize.io` and supply `HINDSIGHT_API_KEY` from the same
runtime secret. Do not run `hindsight configure` or store credential profiles.
Do not use verbose HTTP logging, shell tracing, `hindsight fs`, or page exports
as a Markdown memory mirror. The CLI is not a local server.

Upstream retains the full active branch, including old messages when a session
is resumed or forked. Disabling `autoSeed` prevents background archive ingestion,
not active-branch retention. Start a fresh session for the pilot; only resume or
fork old sessions when retaining that history is intended. There is no custom
cutover-date enforcement. Text and compact tool actions are captured; this is
**not secret redaction**. Keep credentials out of captured sessions.

Service members are trusted collaborators, not hostile tenants. Repository banks
organize relevant recall and reduce accidental mixing; they are not a new sandbox
between members. Preserve existing explicit access grants and owner/admin controls.

Upstream installs its companion skill under
`~/.pi/agent/skills/hindsight-coding-agent/`, writes usage/diagnostic metadata
under `~/.hindsight/`, and caches recalls under the OS temporary directory
(`hindsight-pi/`). These are local runtime artifacts, not authoritative memory.
Treat caches/logs as private; do not commit them or put them in shared snapshots.
Companion-skill copying is native upstream startup behavior. Account for it during
activation; Factory does not intercept it or run the upstream installer.

## Repository-wide consolidation

Native configuration explicitly selects `observationScopes: "shared"`, matching
upstream's default. The importer sends `observation_scopes: "shared"` too.
Provenance tags remain on raw facts, but observations share one untagged scope
within the repository's bank. The server's default `combined` instead isolates
observations by exact tag set: a tagged import and an untagged correction cannot
update the same observations, even when consolidation has finished. Do not use
shared scope to combine intentionally isolated audiences; preserve bank access
controls and repository boundaries.

Inspect `GET /observations/scopes` and document/memory scopes under the bank URL.
For an explicitly approved existing document, native
`PATCH /documents/{document_id}` with `{"observation_scopes":"shared"}` moves its
scope without re-extracting or re-uploading the text. Changed scopes drop and
rebuild affected observations asynchronously; unchanged scopes are a no-op.
Review the document/hash, serialize writes, account for rebuild cost, and verify
source text, raw facts and final observation scope afterward. Update writers
first: later appends with old settings can move a document back. The helper's
same-text duplicate check does not repair existing scopes. Its `verify` checks
explicit shared scope as well as exact source and extraction completion, not
consolidation completion. No replay or full source replacement is needed just
to change scopes. Untagged native CLI
corrections already resolve to the same global scope.

See [observation scopes](https://hindsight.vectorize.io/developer/api/retain#observation_scopes)
and [moving existing documents](https://hindsight.vectorize.io/developer/observations#changing-scopes).

## Read, correct and delete

Use the bank ID from the checkout configuration, not from recalled text.
Native CLI commands (all require the runtime environment above):

```sh
hindsight -o json memory recall BANK "question" --budget low --max-tokens 2000
hindsight -o json memory get BANK MEMORY_ID
hindsight -o json document get BANK DOCUMENT_ID
hindsight -o json operation get BANK OPERATION_ID
```

For changed knowledge, state the new fact and what it supersedes. Native
retention and automatic background consolidation reconcile it **within the same
observation scope**, preserving raw history; no custom cleanup job is needed.
For a one-off extraction error, the documented native curation API instead edits
the underlying world/experience fact and automatically rebuilds derived knowledge.
Do not edit observations directly. Native invalidation removes a fact from active
recall while preserving an audit trail. These writes require approval of the
specific target and consequences; CLI 1.2.1 does not expose PATCH curation, so
check deployed API support. Editing facts leaves their source document unchanged;
reprocessing that document resets curation. See
[native curation](https://hindsight.vectorize.io/developer/api/memories#curation-editing-invalidating--pruning).

For a user-approved source replacement, inspect the document first, then use
`hindsight_ingest_document` with the same ID or the import helper below for
Factory-imported documents.

Extraction completion is not consolidation completion. When qualifying a
correction, inspect the bank's consolidation operations and fresh statistics
(`/operations?type=consolidation` and `/stats?refresh=true` under its bank URL).
Wait for the relevant consolidation to complete with no pending or failed
consolidation, then inspect recall or use Reflect on demand. A disposable Cloud
pilot verified this native flow: observations and Reflect correctly identified
the new value while preserving the previous value as history. Judge current
meaning, not whether the old value still appears. Explicit forgetting is a
separate operation, not routine correction maintenance.

See [upstream consolidation semantics](https://hindsight.vectorize.io/developer/observations).

Only after explicit approval of the exact target and consequences:

```sh
hindsight document delete BANK DOCUMENT_ID
hindsight memory delete BANK MEMORY_ID
```

Document deletion cascades through its extracted units and links. Unit deletion
does not erase other documents mentioning the fact. Neither promises deletion
from provider backups, old Git history or local Pi transcripts. Inspect and
verify the requested scope. Do not clear/delete a whole bank to forget one item.

Stop capture and flush/close affected sessions before deleting or correcting
their source documents. Resuming those transcripts can reintroduce old content.
Do not resume them afterward; use a fresh session and confirm no pending retain
operation will restore the deleted source. A correction is not a secrecy-erasure
guarantee. Never silently upload historical sources to repair a deletion.

## One-time migration and cutover

1. Inventory explicitly selected repository sources; distinguish confirmed rules,
    proposals, superseded material and unrelated/private cross-repository notes.
    Worktrees share their repository bank. Do not scan/upload session archives,
    global/personal memory, legacy databases or entire directories by default.
2. Obtain approval for the bank, reviewed source content and estimated paid
    processing. Create a private, access-restricted recovery copy outside Git,
    Nix outputs, Terraform state and shared snapshots. Record source provenance
    and SHA256 in a private migration manifest. Do not delete originals yet.
3. The adjacent `import.ts` helper handles **one explicit UTF-8 file**. Resolve
    its path relative to this skill. Run with the repository's pinned `tsx` after
    normal dependency installation; no build is needed. This also works under
    `node_modules`, where Node's native TypeScript stripping is disabled.
    `plan` is offline and prints metadata only:

    ```sh
    pnpm exec tsx import.ts plan BANK SOURCE_KEY /private/reviewed-source.txt
    pnpm exec tsx import.ts apply BANK SOURCE_KEY /private/reviewed-source.txt --approve SHA256
    pnpm exec tsx import.ts verify BANK SOURCE_KEY /private/reviewed-source.txt --approve SHA256
    ```

    SOURCE_KEY is a stable repository-relative identity, not a temporary filename
    (for example `.pi/memory/MEMORY.md`). Document IDs remain stable across retries
    and corrected content; operation IDs identify a particular revision/replay.
    Completed operation IDs remain consumed after document deletion. For an
    approved restoration or return to previously imported content, choose a new
    non-secret `--replay ID` and pass it unchanged to `plan`, `apply`, and `verify`.
    Record it in the private migration manifest and reuse it for retries, rather
    than generating a new ID on every attempt.
    The bank must already exist. Differing remote content is never overwritten
    without `--replace REMOTE_SHA256` after review. That hash is a preflight
    check, **not atomic compare-and-swap**: serialize operator changes.
    The helper is not an archive importer, a background service or a memory mirror.
4. Inspect operation completion and exact source readback, then representative
    recall, provenance and repository isolation. Verify recovery replay with an
    approved disposable bank before removing the originals. Retained source files
    can replay imported documents; they are not full bank exports or a guarantee
    of identical extracted observations. For native bank recovery, use the
    `/transfer/export` and `/transfer/import` endpoints under the bank URL,
    not the configuration-template export/import endpoints. CLI 1.2.1 exposes
    template commands, not transfer archives; do not mistake a template for a
    memory backup. See [native bank transfers](https://hindsight.vectorize.io/developer/api/memory-banks).

    A disposable Cloud pilot exported data and bank configuration with debug/audit
    history excluded, deleted the source bank, and restored it from the native ZIP.
    Exact document readback, fact/observation counts, config overrides and recall
    passed. Import re-embeds facts rather than re-extracting them; database IDs are
    not preserved. This is functional recovery, not a byte-identical database
    snapshot. Attachments, pages, webhooks and other populated optional sections
    were not covered by that small fixture.

    Restore requires an absent target bank; submit/poll the restore operation
    against an existing coordinator bank. Keep archives private and outside Git,
    Nix outputs and shared snapshots. Review included configuration for secrets.
    Verify the restored contents before cutover. Bank deletion readback may need
    a bounded wait; confirm listing absence and inaccessible bank data. The pilot
    did not establish retention/deletion of provider-side export objects; account
    for those separately before exporting real memory.
5. Only after verification and consumer activation approval: adopt the shared
    configuration, start a fresh session, remove pi-memory and memory-specific
    QMD wiring, delete obsolete Markdown memory, and update bootstrap guides once.
    Preserve unrelated QMD use. Remove conflicting global pi-memory installation
    as well: project settings do not automatically disable global packages.
    Confirm actual loaded tools/resources and a fresh session's retain/recall.
6. Record every source addition/modification/deletion and all generated/runtime
    directories. Remove temporary fixtures and private scratch copies when their
    approved retention period ends; identify remaining recovery artifacts.

## Infrastructure boundary

Factory's `tf/modules/project/hindsight` manages bank names only through
the REST provider, not memory content, credentials or client-owned bank config.
A disposable Cloud pilot verified creation, no-op planning, managed-name drift
and correction. Provision new repository banks through Terraform from the start;
adoption of existing banks is outside the rollout scope, not a prerequisite.
Do not use create/apply over an existing bank as an adoption workaround.
Use the agreed per-developer runtime key; automatic key provisioning and a
separate bank-scoped-key pilot are not rollout prerequisites. Preserve existing
access grants. Native recovery is qualified for the small fixture described above;
review actual backup coverage and export-object retention before real migration.
Factory provisions `quantile-co--factory` in its existing protected infrastructure
root/backend. Select `github.workflows.hindsight = true` to release the separately
approved `prod` Actions secret `HINDSIGHT_API_TOKEN` only to Plan/Apply jobs.
The Factory app maps it explicitly to native `TF_VAR_hindsight_api_token`; the
root declares that variable **sensitive and ephemeral**, used only by the aliased
Hindsight REST provider. It is not persisted in saved plans or state and must be
supplied again for Apply. Do not substitute an ordinary sensitive variable:
sensitive alone does not prevent persistence. The GitHub provider retains its
separate `REST_API_BEARER`; storage subprocesses receive neither credential.
No credential is a module argument, resource payload or Nix value. Credential
storage/rotation remains an approved manual operation, not Terraform management.

The pinned provider has unusual read-error/drift behavior covered by regression
tests. Unexpected response metadata is rejected after its write/read cycle; that
is not a pre-apply schema gate. Removing the entire resource configuration also
removes Terraform's `prevent_destroy` protection. Saved plans and deployment
approvals are single-use under the owning repository's deployment workflow.

Account setup, credentials, production Plan/Apply, paid uploads, package
publication and each consumer activation require their own approvals.
Do not introduce Factory into an independently managed consumer without approval.
