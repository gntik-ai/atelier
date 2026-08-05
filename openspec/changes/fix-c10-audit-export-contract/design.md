# Design: Contract-conformant audit-export request semantics

## Context

Falcone exposes tenant and workspace audit exports through two guarded POST routes,
`POST /v1/metrics/tenants/{tenantId}/audit-exports` and
`POST /v1/metrics/workspaces/{workspaceId}/audit-exports`. The internal export contract
(`packages/internal-contracts/src/observability-audit-export-surface.json`) and the public OpenAPI
`AuditExportRequest`/`AuditExportManifest` already describe a required `format` (`jsonl`/`csv`), a
`pageSize` default of 500, a maximum of 10000, and a masked manifest projection. The implementation
paths do not agree:

- `apps/control-plane/metrics-handlers.mjs::auditExport` (lines 584-646) defaults an omitted
  `pageSize` to 200, clamps larger requests to 200, never validates `format`, queries before any
  validation, and swallows both the builder's contractual errors and datastore failures into the
  inline fallback or an empty success.
- `apps/control-plane/audit-store.mjs::queryAuditEvents` (lines 454-517) caps the export's legacy
  `limit` branch at 200, the same bound the audit-records list uses, so the store cannot return more
  than 200 export rows.
- `apps/control-plane-executor/src/observability-audit-export.mjs::normalizeFormat` defaults an absent
  `format` to the contract default instead of rejecting it, and `normalizePageSize` already enforces
  the contract default 500 and maximum 10000 but is bypassed because the handler pre-clamps to 200.
- `apps/web-console/src/lib/console-metrics.ts::exportAuditRecords` (lines 463-479) sends only
  `{ filters }` with no `format` and no `pageSize`.

The repair crosses the public handler, SQL store, the shared export builder, the console client, and
the internal/OpenAPI descriptions (which are already correct and must stay covered). P1 and P4 are
the primary exporters; P10 must retain constrained read-only behavior; P12 is a machine client bound
by the same contract; and P13 is the adversarial cross-tenant control. Existing route authorization
remains the security boundary. There is no datastore migration, new producer, persistence,
deployment, or cluster work in this change.

## Goals / Non-Goals

**Goals:**

- Give both guarded routes one strict, canonical request model with a required `format` and a
  `pageSize` default of 500 bounded 1..10000, validated before any datastore access.
- Reject a missing or invalid `format` and an invalid `pageSize` with a coded HTTP `400` before SQL,
  never as a silent clamp, truncation, or successful fallback.
- Let the store honor an export up to 10000 within the authorized scope without altering the
  audit-records list query, which keeps its maximum of 200.
- Make the principal and fallback export paths share one normalized request, scope, and masking
  profile, and never swallow a contractual error into a successful export.
- Update the console client to serialize a contract-valid `format` and `pageSize`.
- Keep the internal contract, OpenAPI, runtime, and console synchronized and covered.

**Non-Goals:**

- C-01 manifest/projection or masking remediation, C-02 error-envelope work, C-08, C-09 list-query
  semantics, roles, permissions, authentication, or authorization policy changes.
- New event producers, export persistence, durable distribution, backfill, storage columns, indexes,
  or any migration.
- Streaming, chunked, or asynchronous export, saved exports, new formats, or new masking profiles.
- Helm, image, gateway, cluster, installation, deployment, or live-environment work.

## Decisions

### Decision 1: Normalize and validate the export request from the contractual source before the datastore

The handler converts either route's parsed request body into one canonical export request only after
the existing scope resolver and `guarded()` authorization have produced canonical tenant/workspace
identity. Normalization draws its defaults and bounds from the contractual source
(`observability-audit-export-surface.json` / the shared builder's `normalizeAuditExportRequest`), so
the serving path cannot drift from the executor-facing contract:

- `format` is required. An omitted `format` is rejected rather than defaulted, and only the contract's
  supported ids (`jsonl`, `csv`) are accepted.
- `pageSize` is omitted or one integer from 1 through 10000. Omission becomes 500; values below 1,
  above 10000, fractional, non-numeric, empty, or otherwise non-integer produce `400`.
- Any supplied time window continues to obey the contract's window rules.

Validation completes before the store is called. Silent clamping to 200 and defaulting `format` were
rejected because they hide client errors and contradict the declared contract. Rejecting an absent
`format` (rather than defaulting to `jsonl`) is required because the contract marks `format`
required; the console compensates by always sending an explicit `jsonl`.

### Decision 2: Bind the export only to `ctx.resolvedScope`; the body never widens scope

`guarded()` already resolves and authorizes the path scope and attaches it as `ctx.resolvedScope`
(the tenant, and for the workspace route the exact workspace). The export handler reads scope only
from `ctx.resolvedScope` and passes it to the store and builder. The request body's `workspaceId` or
any tenant-shaped field is never interpreted as scope: it cannot widen, override, or cross the
authorized scope. Re-deriving scope from the path instead of trusting the body keeps a forged body
inert, and a cross-tenant caller is stopped by the existing guard before body validation runs.

### Decision 3: Add a store export mode/cap without altering the list query

`queryAuditEvents` gains an export read path whose cap is the contractual maximum of 10000 rather than
the list's 200. The export mode is selected by implementation code (for example an explicit
export-limit parameter or mode flag), retains the mandatory `tenant_id` predicate and the exact
workspace predicate for a workspace export, and uses the same masked projection. The audit-records
list path (its paginated `pageSize` branch bounded to 200) is unchanged, so C-09 list semantics and
the list's 200 maximum are preserved. Raising the shared cap for both modes was rejected because it
would change list behavior; a separate export bound keeps the two surfaces independent.

### Decision 4: Share one normalized request across principal and fallback, and never swallow contractual errors

The principal builder path and the inline fallback path receive the identical normalized request —
the validated `format`, the export page limit, the resolved scope, and the masking profile. A
contractual validation error (missing/invalid `format`, out-of-range `pageSize`, unknown masking
profile, invalid window, scope violation) is raised as a coded `400` and is not swallowed into a
successful fallback manifest: the handler validates before selecting a path, so the same invalid
request is rejected whether or not the principal builder resolves. An operational datastore failure is
handled by the established route policy and is not reported as an empty successful export; the prior
`catch { rows = [] }` collapse of contractual and operational failures into a silent empty success is
removed. The fallback stays no less conservative than the principal when masking.

### Decision 5: Preserve the C-01 manifest, projection, and masking

The successful response keeps the C-01 `AuditExportManifest` shape (`exportId`, `queryScope`,
`format`, `maskingProfileId`, `correlationId`, `generatedAt`, `appliedFilters`, `itemCount`,
`maskedItemCount`, `items`) and the `AuditExportedRecord` item projection. Masking continues to run
via the profile so credential-material and provider-locator fields never leave the export surface
unmasked, from either path. C-10 does not re-specify or weaken that behavior; it depends on it and
keeps it covered by compatibility scenarios.

### Decision 6: Serialize a contract-valid request from the console

The console export client sends an explicit `format` defaulting to `jsonl` and an explicit `pageSize`
defaulting to 500, together with the default masking profile and its existing Actor, Category,
Result, From, and To filter controls. Sending an explicit `format` is required because the API now
rejects an absent one; sending `pageSize=500` matches the contract default and the console's expected
export volume. The console keeps its existing empty/loading/error export states; no advanced export
UI is added.

### Decision 7: Preserve authorization, isolation, read-only side-effect-freedom, and error boundaries

The existing guarded route resolves and authorizes tenant/workspace scope before request execution.
This change neither adds permissions nor interprets body content as scope. Authorization denial is
evaluated in the existing order — before body/format/pageSize validation — so a cross-tenant caller is
denied without a format or page-size oracle and without a datastore call. P10 receives corrected
exports only under existing export permission and remains unable to mutate, persist, or cross scopes;
P4 and P12 gain no adjacent privilege. The export performs no application write, domain-audit write,
artifact/export persistence, domain event, or quota mutation; a `400` validation request makes no
datastore call, and an authorized valid request makes one bounded read plus masking.

### Decision 8: Verify the request-to-store-to-console chain with focused local tests

Implementation is test-first. Public black-box handler tests exercise both routes; valid `format`
`jsonl`/`csv`; valid `pageSize` 1, 201, 500, 10000; omitted `pageSize` defaulting to 500; missing and
invalid `format`; invalid `pageSize` 0, 10001, fractional, and string; no datastore call on invalid
input; principal/fallback parity on one normalized request; scope non-widening from the body;
cross-tenant and constrained denial ordering; masking with no secret in the body; and side-effect
freedom. Store tests assert the export mode returns up to 10000 while the list stays at 200, that
mandatory tenant/workspace predicates are retained, and that no unscoped SELECT runs without a tenant.
Contract tests bind the internal export contract and both OpenAPI operations to the runtime for the
required `format`, default 500, maximum 10000, and manifest shape. A console client test asserts the
serialized `format=jsonl` and `pageSize=500`. Focused test commands and strict OpenSpec validation
are sufficient for this design phase; no browser, live cluster, external service, credential,
deployment, or Helm action belongs to this change.

## Risks / Trade-offs

- **[10000-record payload size]** → Keep the export synchronous and bounded by `pageSize`, document
  the larger payload/latency/memory cost, and defer any streaming/asynchronous distribution to future
  work rather than widening this change.
- **[Validation tightening changes tolerated requests]** → Update the console to send contract-valid
  `format` and `pageSize`, keep valid requests succeeding, and return `400` only for missing/invalid
  input.
- **[Contractual error swallowed into a successful fallback]** → Validate before selecting a path, so
  the same invalid request is rejected with or without the principal builder, and separate
  operational failure from a valid empty result.
- **[Masking or manifest regression across paths]** → Share the normalized request and masking
  profile, keep the fallback no less conservative than the principal, and preserve the C-01 manifest
  and projection under compatibility tests.
- **[Body-driven scope creep]** → Bind scope only to `ctx.resolvedScope`, treat every body scope field
  as inert, and prove a foreign body cannot widen scope.
- **[List and export caps drift together]** → Give the store a distinct export cap and assert the
  audit-records list still bounds at 200.

## Migration Plan

No schema, data, index, export persistence, deployment, or cluster migration is required. Existing
rows are read through the same masked projection. The runtime, contract, and console changes ship as
one application change. A code rollback restores the prior default-200, clamp-200, unvalidated-format
export behavior without transforming stored data; after rollback the console would again send no
`format`, which the reverted handler tolerates. The change confines itself to the export handler, the
store export mode, the console export client, and their tests, so it introduces no scope creep into
C-01, C-02, C-08, or C-09.

## Open Questions

None. The required `format`, the `pageSize` default and maximum, the export cap, the scope binding,
the manifest projection, the personas, and the out-of-scope boundaries are fixed by this change.
