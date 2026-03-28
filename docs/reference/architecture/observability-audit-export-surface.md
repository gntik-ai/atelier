# Observability audit export surface

## Purpose

`US-OBS-02-T04` establishes the governed audit export and sensitive-data masking baseline for the platform.

This document is the human-readable companion to:

- `services/internal-contracts/src/observability-audit-export-surface.json`
- `scripts/lib/observability-audit-export-surface.mjs`
- `scripts/validate-observability-audit-export-surface.mjs`

It defines the bounded export request model, export manifest metadata, masking profiles, protected-field coverage, route bindings, and console export settings that extend the existing audit query surface.

## Scope boundary

This increment defines the **export + masking contract only**.

Included in `US-OBS-02-T04`:

- tenant- and workspace-scoped audit export surfaces
- bounded export request semantics
- supported export formats (`jsonl`, `csv`)
- deterministic masking of protected audit detail fields
- exported-record masking metadata
- explicit audit export permissions
- console export metadata

Explicitly deferred to later tasks:

- cross-system causal correlation (`US-OBS-02-T05`)
- durable export distribution or signed-download workflows
- restore/import/replay behavior
- end-to-end traceability and data-protection verification (`US-OBS-02-T06`)

## Source contracts reused

This baseline depends on and must stay aligned with:

- `services/internal-contracts/src/observability-audit-pipeline.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/observability-audit-query-surface.json`
- `services/internal-contracts/src/authorization-model.json`

### Why T03 filter reuse matters

T04 does not introduce a second filtering language. Export requests reuse the T03 query/filter vocabulary so console consultation and evidence packaging stay aligned.

## Export scopes

The initial export scopes are intentionally symmetric with the T03 query scopes.

### Tenant export

- route operation id: `exportTenantAuditRecords`
- permission: `tenant.audit.export`
- tenant binding: required
- workspace binding: optional narrowing only

### Workspace export

- route operation id: `exportWorkspaceAuditRecords`
- permission: `workspace.audit.export`
- workspace binding: required and immutable from caller context

## Supported formats

The first bounded format catalog is:

- `jsonl` — machine-readable audit evidence handoff
- `csv` — governance/compliance review handoff

No archive, restore, or binary delivery workflow is introduced in this increment.

## Masking policy

The export surface derives its protected field coverage from the audit-pipeline masking baseline.

Protected field classes currently covered:

- `credential_material`
  - `password`
  - `secret`
  - `token`
  - `authorization_header`
  - `connection_string`
- `provider_locator`
  - `raw_hostname`
  - `raw_endpoint`
  - `object_key`
  - `raw_topic_name`

Required behavior:

- protected values are replaced with a deterministic placeholder
- the canonical audit envelope remains intact
- exported records explicitly declare whether masking was applied
- exported records list the masked field refs and sensitivity categories

## Manifest and exported-record shape

The bounded response is a manifest-style preview rather than a persisted export job.

Required manifest fields:

- `exportId`
- `queryScope`
- `format`
- `maskingProfileId`
- `correlationId`
- `generatedAt`
- `appliedFilters`
- `itemCount`
- `maskedItemCount`
- `items`

Required exported-record fields:

- canonical audit projection fields from the T02 envelope
- `detail`
- `maskingApplied`
- `maskedFieldRefs`
- `sensitivityCategories`

## Console surface

The console export surface is shared and contract-backed.

It provides:

- entry scopes (`tenant`, `workspace`)
- supported formats and default format
- default masking profile
- masking badge labels
- export-safe preset ids reused from the audit explorer
- empty/loading/error state ids

## Permissions and isolation

This increment introduces explicit export permissions:

- `tenant.audit.export`
- `workspace.audit.export`

Export is intentionally narrower than plain read visibility:

- tenant/workspace viewers do not receive export by default in this increment
- workspace exports must remain in one workspace
- tenant exports may narrow to one workspace but cannot widen across tenants

## Validation and discoverability

Primary validation entry point:

```bash
npm run validate:observability-audit-export-surface
```

The T04 validator checks:

- source-contract version alignment
- required export scopes
- route existence in the generated route catalog
- known authorization actions
- supported format coverage
- default masking profile presence
- protected-field coverage against the T01 forbidden field catalog
- T03 filter reuse alignment
- preserved downstream boundaries for T05/T06

## Explicit boundary to later tasks

This increment does **not** implement:

- correlation graphs or cross-system causation (`US-OBS-02-T05`)
- durable export distribution or replay
- end-to-end verification suites (`US-OBS-02-T06`)

T04 only defines the safe export and masking baseline those later tasks will extend.
