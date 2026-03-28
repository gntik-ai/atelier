# Implementation Plan: Storage Audit for Administrative and Data-Plane Operations

**Branch**: `022-storage-audit-ops` | **Date**: 2026-03-28 | **Spec**: `specs/022-storage-audit-ops/spec.md`
**Task**: US-STO-03-T04 | **Epic**: EP-12 — Storage S3-compatible
**Requirements traceability**: RF-STO-018

---

## Summary

Introduce a unified storage audit surface for the multi-tenant BaaS platform. The existing storage modules already emit heterogeneous audit-relevant events (`buildStorageMutationEvent`, `buildStorageErrorAuditEvent`, `buildStorageEventNotificationAuditEvent`, `buildStorageUsageAuditEvent`, `buildStorageImportExportAuditEvent`) but there is no canonical schema, no coverage of administrative operations (bucket creation/deletion, policy changes, quota adjustments, tenant context mutations), and no queryable trail. This plan introduces:

1. A new adapter module `storage-audit-ops.mjs` with the unified schema, administrative audit builders, normalization, a query surface, and an audit coverage report.
2. Extensions to `storage-admin.mjs` in the control plane that expose the new audit query endpoints and re-export the audit symbols.
3. Unit and adapter-level tests in the existing `node --test` runner conventions.

---

## Technical Context

**Language/Version**: Node.js (ESM, `.mjs`); same as all other storage adapters in the repo.  
**Primary Dependencies**: Built-in modules only (`node:crypto` for `eventId` generation); imports from sibling adapter modules. No new npm packages.  
**Storage / Event Bus**: Kafka topic `storage.audit.events` (mirrors the `function.audit.events` pattern in `functions-audit.mjs`). The adapter module is persistence-agnostic; it produces plain JavaScript objects and delegates publishing to an injected `publishAuditEvent` callback (dependency-injection pattern already used by `functions-audit.mjs`).  
**Testing**: `node --test` with `node:assert/strict`; same structure as `tests/unit/storage-admin.test.mjs` and `tests/adapters/storage-event-notifications.test.mjs`.  
**Target Platform**: Kubernetes / OpenShift via Helm; runtime in Apache OpenWhisk actions that import from `apps/control-plane/src/storage-admin.mjs`.  
**Performance Goals**: Query response ≤ 5 s for up to 30-day range, 500-event pages (SC-001). The adapter layer is stateless; performance depends on the persistence backend injected at runtime.  
**Constraints**: No cross-tenant data leakage; no secret key material or presigned URLs in any audit event; all string fields pass through `sanitizeAuditString`; meta-audit events for audit queries must not trigger recursive meta-auditing.  
**Scale/Scope**: Multi-tenant; every tenant/workspace boundary is a hard isolation boundary in all query and event functions.

---

## Project Structure

### Documentation (this feature)

```text
specs/022-storage-audit-ops/
├── spec.md              # Feature specification (input)
└── plan.md              # This file
```

### Source Code

```text
services/adapters/src/
└── storage-audit-ops.mjs          # NEW — unified schema, builders, normalizer,
                                   #        query surface, coverage report

apps/control-plane/src/
└── storage-admin.mjs              # MODIFIED — import and re-export audit symbols,
                                   #             add listStorageAuditRoutes()

tests/unit/
└── storage-audit-ops.test.mjs     # NEW — unit tests (pure function behaviour)

tests/adapters/
└── storage-audit-ops.test.mjs     # NEW — adapter-level integration tests
                                   #        (normalization round-trips, injection)
```

No database migrations are introduced by this plan. The audit persistence backend (PostgreSQL table, Kafka + consumer, or dedicated audit store) is injected at runtime and is outside the scope of this adapter-layer plan. DDL guidance is included in the Risks section for implementation teams that choose PostgreSQL.

---

## Architecture and Flow

### Unified Audit Event Schema

Every storage audit event produced by the new module conforms to:

```js
{
  eventId:           string,   // crypto random UUID or sha256-derived
  eventType:         string,   // hierarchical, e.g. "storage.bucket.create"
  operationCategory: 'data_plane' | 'administrative' | 'error' | 'lifecycle',
  operationType:     string,   // specific action, e.g. "bucket.create"
  actorId:           string,   // principal who performed the operation
  actorType:         'user' | 'service_account' | 'system' | 'superadmin',
  credentialId:      string | null,
  outcome:           'success' | 'denied' | 'error' | 'rejected',
  resourceScope: {
    tenantId:    string | null,
    workspaceId: string | null,
    bucketId:    string | null,
    objectKey:   string | null
  },
  changeSummary:     object | null,  // admin mutations only
  errorCode:         string | null,
  policySource:      string | null,  // access-decision events
  triggerSource:     string | null,  // lifecycle/cascade events
  cascadeTriggered:  boolean | null,
  cascadeScope:      object | null,
  correlationId:     string | null,
  occurredAt:        string           // ISO-8601
}
```

All string fields pass through `sanitizeAuditString` before the event is frozen and returned.

### Module Boundaries

```text
┌─────────────────────────────────────────────────────────┐
│  storage-audit-ops.mjs  (services/adapters/src/)        │
│                                                         │
│  UNIFIED SCHEMA BUILDERS                                │
│  buildStorageAdminAuditEvent(type, context, detail)     │
│  buildStorageAccessDeniedAuditEvent(context, detail)    │
│  buildStorageCredentialLifecycleAuditEvent(ctx, detail) │
│  buildStorageMetaAuditEvent(context, query)             │
│                                                         │
│  NORMALIZATION                                          │
│  normalizeStorageAuditEvent(sourceEvent)                │
│                                                         │
│  QUERY SURFACE                                          │
│  queryStorageAuditTrail(context, params)                │
│  buildStorageAuditCoverageReport(context, params)       │
│                                                         │
│  CONSTANTS                                              │
│  STORAGE_AUDIT_OPERATION_TYPES                          │
│  STORAGE_AUDIT_OPERATION_CATEGORIES                     │
│  STORAGE_AUDIT_ERROR_CODES                              │
│  STORAGE_AUDIT_TOPIC                                    │
│  STORAGE_AUDIT_COVERAGE_CATEGORIES                      │
└────────────────────────┬────────────────────────────────┘
                         │ re-exported via
┌────────────────────────▼────────────────────────────────┐
│  storage-admin.mjs  (apps/control-plane/src/)           │
│  (MODIFIED — adds audit imports + listStorageAuditRoutes│
└─────────────────────────────────────────────────────────┘
```

### Query Authorization Flow

```text
queryStorageAuditTrail(context, params)
  │
  ├─ assertAuditQueryScope(context, params)
  │     developer  → restrict to own actorId/credentialId within authorized workspaces
  │     workspace_admin → restrict to own workspaceId within own tenantId
  │     tenant_owner    → restrict to own tenantId
  │     superadmin      → unrestricted
  │
  ├─ normalizeAuditQueryParams(params)  (limit ≤ 500, default 50)
  │
  ├─ emitMetaAuditEvent (operationType: "audit.query", NOT self-referential)
  │
  └─ context.queryAuditRecords(normalizedQuery) → { items, cursor, total }
```

### Administrative Event Flow (call-site pattern)

Administrative events are emitted at the call site of the mutating operation, not inside the pure builder/evaluator:

```js
// Example: bucket creation handler
const auditEvent = buildStorageAdminAuditEvent(
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_CREATE,
  { actorId, actorType, tenantId, workspaceId, correlationId },
  { bucketId: newBucket.resourceId, changeSummary: { ... }, outcome: 'success' }
);
publishAuditEvent(auditEvent, context);
```

Access-denial events follow the same pattern, emitted at the call site of `evaluateStorageAccessDecision` when it returns `deny`:

```js
if (decision.outcome === 'deny') {
  const event = buildStorageAccessDeniedAuditEvent(context, {
    requestedAction, targetResource, policySource, credentialId
  });
  publishAuditEvent(event, context);
}
```

---

## Detailed Changes per Artifact

### `services/adapters/src/storage-audit-ops.mjs` (NEW)

**Exports:**

| Export | Type | Description |
|---|---|---|
| `STORAGE_AUDIT_TOPIC` | `string` | Kafka topic: `'storage.audit.events'` |
| `STORAGE_AUDIT_OPERATION_CATEGORIES` | `frozen object` | `data_plane`, `administrative`, `error`, `lifecycle` |
| `STORAGE_AUDIT_OPERATION_TYPES` | `frozen object` | All 20+ operation type constants (see FR-007, FR-013) |
| `STORAGE_AUDIT_ERROR_CODES` | `frozen object` | `AUDIT_SCOPE_UNAUTHORIZED`, `AUDIT_QUERY_INVALID`, `AUDIT_COVERAGE_UNAVAILABLE` |
| `STORAGE_AUDIT_COVERAGE_CATEGORIES` | `frozen array` | 15 categories per FR-024 |
| `buildStorageUnifiedAuditEvent` | `function` | Low-level builder for any unified audit event; applies `sanitizeAuditString` to all string fields; freezes result |
| `buildStorageAdminAuditEvent` | `function` | Builder for administrative operations (FR-007, FR-008, FR-009) |
| `buildStorageAccessDeniedAuditEvent` | `function` | Builder for access-denial events (FR-010, FR-011) |
| `buildStorageCredentialLifecycleAuditEvent` | `function` | Builder for credential lifecycle events (FR-013) |
| `buildStorageMetaAuditEvent` | `function` | Builder for meta-audit (audit-query) events (FR-026) |
| `normalizeStorageAuditEvent` | `function` | Converts existing builder outputs into unified schema (FR-004–FR-006) |
| `queryStorageAuditTrail` | `function` | Query surface with scope enforcement and pagination (FR-014–FR-018, FR-019–FR-021, FR-026) |
| `buildStorageAuditCoverageReport` | `function` | Coverage report (FR-022–FR-025) |
| `emitStorageAuditEvent` | `function` | Thin publish wrapper (same pattern as `functions-audit.mjs`) |

**Key internal helpers (not exported):**

- `sanitizeAuditString(value)` — mirrors the implementation in `storage-event-notifications.mjs` (strips URLs, secret refs, key material).
- `generateEventId(seed)` — SHA-256 of `seed + Date.now()` truncated to 32 chars, with `sevt_` prefix.
- `assertAuditQueryScope(context, params)` — enforces FR-019–FR-021; throws `AUDIT_SCOPE_UNAUTHORIZED` on violation.
- `normalizeQueryParams(params)` — validates limit (max 500, default 50), date formats; throws `AUDIT_QUERY_INVALID` on malformed input.
- `categoryForEventType(eventType)` — maps existing event type strings to `operationCategory` (FR-006).
- `CATEGORY_OPERATION_TYPE_MAP` — static map used by coverage report (FR-023, FR-024).

**`STORAGE_AUDIT_OPERATION_TYPES` constants (complete list):**

```js
{
  // Data-plane
  OBJECT_PUT:   'object.put',
  OBJECT_GET:   'object.get',
  OBJECT_DELETE:'object.delete',
  OBJECT_LIST:  'object.list',
  // Administrative
  BUCKET_CREATE:'bucket.create',
  BUCKET_DELETE:'bucket.delete',
  BUCKET_POLICY_CREATE:'bucket_policy.create',
  BUCKET_POLICY_UPDATE:'bucket_policy.update',
  BUCKET_POLICY_DELETE:'bucket_policy.delete',
  BUCKET_POLICY_SUPERADMIN_OVERRIDE:'bucket_policy.superadmin_override',
  WORKSPACE_PERMISSIONS_UPDATE:'workspace_permissions.update',
  TENANT_TEMPLATE_UPDATE:'tenant_template.update',
  QUOTA_TENANT_UPDATE:'quota.tenant_update',
  QUOTA_WORKSPACE_UPDATE:'quota.workspace_update',
  TENANT_CONTEXT_PROVISION:'tenant_context.provision',
  TENANT_CONTEXT_SUSPEND:'tenant_context.suspend',
  TENANT_CONTEXT_REACTIVATE:'tenant_context.reactivate',
  TENANT_CONTEXT_DELETE:'tenant_context.delete',
  // Credential lifecycle
  CREDENTIAL_CREATE:'credential.create',
  CREDENTIAL_ROTATE:'credential.rotate',
  CREDENTIAL_REVOKE:'credential.revoke',
  CREDENTIAL_EXPIRE:'credential.expire',
  // Access
  ACCESS_DENIED:'access.denied',
  // Meta
  AUDIT_QUERY:'audit.query'
}
```

**`normalizeStorageAuditEvent` mapping table:**

| Source event `eventType` | `operationCategory` | `operationType` mapping |
|---|---|---|
| `storage.*` (from `buildStorageMutationEvent`) | `data_plane` | parsed from `eventType` suffix |
| `storage.error.normalized` | `error` | `error.normalized` |
| `storage.event_notification.audit` | `lifecycle` | `event_notification.` + `action` |
| `storage.usage.*` (from `buildStorageUsageAuditEvent`) | `administrative` | `usage_report.query` |
| `storage.import_export.*` | `data_plane` | `import_export.` + `operationType` |
| Unknown | `data_plane` | `unknown` |

Fields absent in source events are set to `null`, not omitted (FR-005).

### `apps/control-plane/src/storage-admin.mjs` (MODIFIED)

**Additions only** (no existing exports removed or changed):

```js
// New import block added alongside existing adapter imports:
import {
  STORAGE_AUDIT_TOPIC,
  STORAGE_AUDIT_OPERATION_CATEGORIES,
  STORAGE_AUDIT_OPERATION_TYPES,
  STORAGE_AUDIT_ERROR_CODES,
  STORAGE_AUDIT_COVERAGE_CATEGORIES,
  buildStorageAdminAuditEvent,
  buildStorageAccessDeniedAuditEvent,
  buildStorageCredentialLifecycleAuditEvent,
  normalizeStorageAuditEvent,
  queryStorageAuditTrail,
  buildStorageAuditCoverageReport,
  emitStorageAuditEvent
} from '../../../services/adapters/src/storage-audit-ops.mjs';

// Re-exports (catalog pattern):
export const STORAGE_AUDIT_TOPIC_CATALOG = STORAGE_AUDIT_TOPIC;
export const STORAGE_AUDIT_CATEGORY_CATALOG = STORAGE_AUDIT_OPERATION_CATEGORIES;
export const STORAGE_AUDIT_OPERATION_TYPE_CATALOG = STORAGE_AUDIT_OPERATION_TYPES;
export const STORAGE_AUDIT_ERROR_CATALOG = STORAGE_AUDIT_ERROR_CODES;
export const STORAGE_AUDIT_COVERAGE_CATEGORY_CATALOG = STORAGE_AUDIT_COVERAGE_CATEGORIES;
export {
  buildStorageAdminAuditEvent,
  buildStorageAccessDeniedAuditEvent,
  buildStorageCredentialLifecycleAuditEvent,
  normalizeStorageAuditEvent,
  queryStorageAuditTrail,
  buildStorageAuditCoverageReport,
  emitStorageAuditEvent
};

// New route-listing function:
export function listStorageAuditRoutes(filters = {}) {
  const routes = [
    getPublicRoute('listStorageAuditTrail'),
    getPublicRoute('getStorageAuditCoverage')
  ].filter(Boolean);
  return routes.filter((route) => matchesRouteFilters(route, filters));
}
```

The `listStorageAdminRoutes` function is updated to include `listStorageAuditRoutes()` output in its combined routes array.

**Note**: `getPublicRoute('listStorageAuditTrail')` and `getPublicRoute('getStorageAuditCoverage')` will return `undefined` until the internal contracts service registers these routes. The `listStorageAuditRoutes` function uses `.filter(Boolean)` and the plan scope stops at the adapter/control-plane boundary. Route registration in the internal contracts service is a dependency tracked as a blocker in the Risks section.

---

## Test Strategy

### Unit tests — `tests/unit/storage-audit-ops.test.mjs` (NEW)

Pattern: `node --test`; pure function tests with no I/O. Follows `tests/unit/storage-admin.test.mjs` conventions.

**Test groups:**

1. **`buildStorageUnifiedAuditEvent`**
   - Required fields are present and frozen.
   - `sanitizeAuditString` strips URLs and key material from all string fields.
   - `eventId` is always a non-empty string with `sevt_` prefix.
   - `occurredAt` defaults to a valid ISO-8601 string when not provided.

2. **`buildStorageAdminAuditEvent`**
   - Each of the 14 administrative operation types produces an event with correct `operationType`, `operationCategory: 'administrative'`, and `changeSummary`.
   - `cascadeTriggered` and `cascadeScope` are populated for lifecycle operations.
   - Full policy document is never included (only `changeSummary`).
   - System-originated events use `actorType: 'system'` and `actorId` matching `system:*` prefix.

3. **`buildStorageAccessDeniedAuditEvent`**
   - `outcome: 'denied'`, `operationType: 'access.denied'`.
   - `policySource` is captured correctly.
   - `credentialId` is included when provided, `null` when not.
   - Full policy document is never included (only `policySource` and optional `statementId`).

4. **`buildStorageCredentialLifecycleAuditEvent`**
   - `credentialId` is mandatory (throws on missing).
   - All four lifecycle types (`credential.create`, `.rotate`, `.revoke`, `.expire`) produce correct events.

5. **`buildStorageMetaAuditEvent`**
   - `operationType: 'audit.query'`.
   - Query results are not included.
   - `operationCategory: 'administrative'`.

6. **`normalizeStorageAuditEvent`**
   - Round-trip for each of the 5 source event types preserves audit-relevant fields.
   - Fields absent in source are `null`, not `undefined`.
   - `operationCategory` is assigned correctly per mapping table.
   - Unknown `eventType` falls back gracefully.

7. **`queryStorageAuditTrail` — scope enforcement**
   - Developer querying another developer's events → throws `AUDIT_SCOPE_UNAUTHORIZED`.
   - Workspace admin querying another workspace → throws `AUDIT_SCOPE_UNAUTHORIZED`.
   - Tenant owner querying another tenant → throws `AUDIT_SCOPE_UNAUTHORIZED`.
   - Superadmin (`context.isSuperadmin = true`) → no scope error.
   - `limit > 500` → throws `AUDIT_QUERY_INVALID`.
   - Malformed `fromTimestamp` → throws `AUDIT_QUERY_INVALID`.
   - Valid query invokes injected `context.queryAuditRecords` with normalized params.
   - Query emits meta-audit event via `context.publishAuditEvent`.
   - Meta-audit event does NOT trigger another meta-audit call (no recursion).

8. **`buildStorageAuditCoverageReport`**
   - All 15 coverage categories are present in output.
   - `scopeType: 'tenant'` accepted; `scopeType: 'platform'` requires `isSuperadmin`.
   - Non-superadmin requesting platform scope → throws `AUDIT_COVERAGE_UNAVAILABLE`.
   - Coverage status is `'covered'` when `queryCoverage` returns a recent event, `'gap'` otherwise.
   - `windowDays` defaults to 30; custom value is passed through.

### Adapter tests — `tests/adapters/storage-audit-ops.test.mjs` (NEW)

Pattern: `node --test` with injected stubs (no real I/O). Follows `tests/adapters/storage-event-notifications.test.mjs` conventions.

**Test groups:**

1. **Normalization round-trips** — takes a real output from each of the 5 source builders and verifies `normalizeStorageAuditEvent` produces a valid unified event with no field loss.
2. **`emitStorageAuditEvent`** — verifies that the injected `publishAuditEvent` callback receives the correct topic and event payload.
3. **`queryStorageAuditTrail` with stub loader** — verifies cursor pagination, filter passthrough, result shape, and that the meta-audit event is emitted before the query loader is called.
4. **`buildStorageAuditCoverageReport` with stub coverage loader** — verifies `gap` detection when `queryCoverage` returns `null` for a category within the window.
5. **Sanitization regression** — constructs events with deliberate secret/URL injections in every string field; asserts `[redacted-url]` / `[redacted]` patterns appear; asserts no raw secret material escapes.
6. **Tenant isolation assertion** — verifies that `queryStorageAuditTrail` called with `tenantId: T1` never produces results tagged with `tenantId: T2` even if the stub loader incorrectly returns mixed data (the function must strip cross-tenant results).

### Integration test hints (out of scope for this plan, tracked for US-STO-03-T05)

- End-to-end: emit an administrative event, query it via `queryStorageAuditTrail`, verify it appears in the result.
- Cross-tenant isolation: confirm that workspace-admin token from T1 cannot retrieve T2 events via the API endpoint.

---

## Data Model and Kafka Topic

**Kafka topic**: `storage.audit.events`  
**Partition key**: `tenantId` (ensures per-tenant ordering; enables consumer-side tenant isolation).  
**Retention**: Governed by platform policy, not this spec.

**Suggested PostgreSQL DDL** (for implementations that choose PostgreSQL as the audit store — not normative):

```sql
CREATE TABLE storage_audit_events (
  event_id          TEXT        PRIMARY KEY,
  event_type        TEXT        NOT NULL,
  operation_category TEXT       NOT NULL,
  operation_type    TEXT        NOT NULL,
  actor_id          TEXT        NOT NULL,
  actor_type        TEXT        NOT NULL,
  credential_id     TEXT,
  outcome           TEXT        NOT NULL,
  tenant_id         TEXT        NOT NULL,
  workspace_id      TEXT,
  bucket_id         TEXT,
  object_key        TEXT,
  change_summary    JSONB,
  error_code        TEXT,
  policy_source     TEXT,
  trigger_source    TEXT,
  cascade_triggered BOOLEAN,
  cascade_scope     JSONB,
  correlation_id    TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sae_tenant_time  ON storage_audit_events (tenant_id, occurred_at DESC);
CREATE INDEX idx_sae_workspace    ON storage_audit_events (tenant_id, workspace_id, occurred_at DESC);
CREATE INDEX idx_sae_actor        ON storage_audit_events (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX idx_sae_credential   ON storage_audit_events (tenant_id, credential_id, occurred_at DESC) WHERE credential_id IS NOT NULL;
CREATE INDEX idx_sae_correlation  ON storage_audit_events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_sae_op_type      ON storage_audit_events (tenant_id, operation_type, occurred_at DESC);
CREATE INDEX idx_sae_outcome      ON storage_audit_events (tenant_id, outcome, occurred_at DESC);
```

Row-Level Security (RLS) should enforce `tenant_id` isolation for any direct database consumer.

---

## Rollout and Rollback

### Rollout sequence

1. **Merge `storage-audit-ops.mjs`** with all builders, normalization, and query surface. Run unit and adapter tests. No runtime effect — module is not imported by anything yet.
2. **Merge `storage-admin.mjs` extension** (adds imports and re-exports). Existing tests for `storage-admin.mjs` must continue to pass without changes. The new `listStorageAuditRoutes` returns an empty array until internal contracts registers the routes, which is safe.
3. **Register Kafka topic** `storage.audit.events` with appropriate partitioning and retention settings.
4. **Deploy consumer / persistence layer** (OpenWhisk action or a dedicated consumer service) that reads from `storage.audit.events` and writes to the chosen audit store.
5. **Register API routes** (`listStorageAuditTrail`, `getStorageAuditCoverage`) in the internal contracts service and APISIX.
6. **Enable call-site emission** in the operational code paths (bucket CRUD handlers, policy mutation handlers, access policy evaluation wrappers) — this is where individual feature story tasks integrate the audit builders. This plan produces the builders; call-site integration is tracked per operation story.

### Rollback

- Steps 1–2 are additive and safe to revert by reverting the module files. No data migrations.
- Step 3 (Kafka topic creation) is additive and does not affect existing topics.
- Steps 4–6 can be disabled by removing the consumer deployment and API route entries; the adapter module remains but emits nothing without call-site integration.

### Idempotency

- `buildStorage*AuditEvent` functions are pure and deterministic for a given input (except `generateEventId` which incorporates a timestamp; if idempotency of `eventId` is required at the call site, the caller should supply a stable `eventId` seed).
- `emitStorageAuditEvent` delegates to the injected publisher; idempotency of delivery is the publisher/broker responsibility (Kafka at-least-once; deduplication by `eventId` in the consumer is recommended).

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Internal contracts service does not have `listStorageAuditTrail` / `getStorageAuditCoverage` route entries | Likely (not yet defined) | `listStorageAuditRoutes` returns `[]`; API routes are unreachable until registered | Track as an explicit dependency; `listStorageAuditRoutes` degrades gracefully with `filter(Boolean)`. Routes must be added to the contracts service before Step 5 of rollout. |
| Normalization loses audit-relevant fields from future builder changes | Low | Silent data loss in unified trail | `normalizeStorageAuditEvent` copies all known fields explicitly and passes through `rawSourceEvent` in a `_source` property (debug-only, stripped before persistence). Unit tests assert field-by-field round-trip. |
| Meta-audit recursion (`audit.query` triggers another `audit.query`) | Low | Infinite loop | `emitStorageAuditEvent` checks `operationType === 'audit.query'` and skips publishing the meta-event for meta-events. Unit test asserts single-call depth. |
| High-volume audit events overwhelming Kafka / consumer | Medium | Consumer lag, delayed trail | Partition by `tenantId`. Consumer should batch-write to persistence. This is an infrastructure concern; the adapter is stateless and makes no assumptions about throughput. |
| Cross-tenant data leakage via injected `queryAuditRecords` stub returning mixed results | Low | Compliance violation | `queryStorageAuditTrail` filters results server-side after the loader returns: any event with `resourceScope.tenantId !== context.tenantId` is dropped (for non-superadmin callers). Unit test covers this. |
| `changeSummary` inadvertently serializes full policy document | Medium | Sensitive data exposure | `buildStorageAdminAuditEvent` for policy-change types accepts only `{ statementsAdded, statementsRemoved, statementsModified }` shape for `changeSummary` and rejects/ignores other keys. Unit test asserts full doc is never present. |

---

## Implementation Sequence

```text
Step 1 — Create services/adapters/src/storage-audit-ops.mjs
  ├── Constants and frozen catalogs
  ├── Internal helpers (sanitizeAuditString, generateEventId, assertAuditQueryScope)
  ├── buildStorageUnifiedAuditEvent (low-level)
  ├── buildStorageAdminAuditEvent
  ├── buildStorageAccessDeniedAuditEvent
  ├── buildStorageCredentialLifecycleAuditEvent
  ├── buildStorageMetaAuditEvent
  ├── normalizeStorageAuditEvent (all 5 source-event type branches)
  ├── emitStorageAuditEvent
  ├── queryStorageAuditTrail
  └── buildStorageAuditCoverageReport

Step 2 — Create tests/unit/storage-audit-ops.test.mjs
  └── All 8 test groups above

Step 3 — Create tests/adapters/storage-audit-ops.test.mjs
  └── All 6 test groups above

Step 4 — Modify apps/control-plane/src/storage-admin.mjs
  ├── Add import block for storage-audit-ops.mjs exports
  ├── Add re-exports (catalog pattern)
  └── Add listStorageAuditRoutes() and update listStorageAdminRoutes()

Step 5 — Verify existing tests still pass
  └── node --test tests/unit/storage-admin.test.mjs (must be unaffected)

Step 6 — Register Kafka topic, deploy consumer, register API routes
  (infrastructure / contracts steps; outside this plan's source code scope)
```

Steps 1–5 are parallelizable within the same feature branch. Step 6 is a sequential dependency.

---

## Done Criteria

The following are **verifiable** and map directly to the spec acceptance criteria and success criteria:

| # | Criterion | Evidence |
|---|---|---|
| 1 | `storage-audit-ops.mjs` exists and exports all symbols listed above | `node --test tests/unit/storage-audit-ops.test.mjs` passes |
| 2 | All 14 administrative operation types have builders that produce unified-schema events | Unit test group 2 passes (14 sub-tests) |
| 3 | All 5 source event types normalize to the unified schema without field loss | Adapter test group 1 passes |
| 4 | Denied-access events include `policySource`, `outcome: 'denied'`, and optional `credentialId` | Unit test group 3 passes |
| 5 | Credential lifecycle events include `credentialId` for all 4 lifecycle actions | Unit test group 4 passes |
| 6 | `queryStorageAuditTrail` enforces developer/workspace-admin/tenant-owner/superadmin scopes | Unit test group 7 passes (4 scope variants) |
| 7 | Tenant isolation: cross-tenant results dropped after loader returns | Adapter test group 6 passes |
| 8 | `buildStorageAuditCoverageReport` returns all 15 categories with `covered`/`gap` status | Unit test group 8 passes |
| 9 | Meta-audit emitted for every query; no recursive meta-audit loop | Unit test group 7 (meta-audit assertions) pass |
| 10 | No secret key material or presigned URL appears in any audit event | Adapter test group 5 (sanitization regression) passes |
| 11 | `storage-admin.mjs` re-exports all audit symbols; `listStorageAdminRoutes` includes audit routes | `node --test tests/unit/storage-admin.test.mjs` passes with audit symbol assertions |
| 12 | Existing storage-admin tests are unaffected | `node --test tests/unit/storage-admin.test.mjs` passes without modification |
| 13 | `changeSummary` in policy-change events contains only count fields, not full documents | Unit test group 2, sub-test for policy mutation |
| 14 | System-originated events (cascade, expiry) use `actorId: 'system:*'` prefix | Unit test group 2, lifecycle sub-tests |

---

## Blockers

1. **Internal contracts service routes**: `listStorageAuditTrail` and `getStorageAuditCoverage` must be registered before the API endpoints are reachable. This is a pre-Step-6 dependency and does not block Steps 1–5.
2. **Call-site integration**: The audit builders produced here must be invoked by the operational code paths (bucket handlers, policy handlers, access-policy evaluation wrappers). Those call-site integrations are tracked as individual implementation tasks per operation type and are not in scope for this plan.
3. **Audit persistence backend decision**: The query surface delegates to an injected `context.queryAuditRecords`. The choice of backend (PostgreSQL, Kafka + materialized view, dedicated audit store) must be made before Step 6 of the rollout. The DDL guidance in this plan covers the PostgreSQL option.
