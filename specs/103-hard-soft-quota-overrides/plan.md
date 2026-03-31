# Implementation Plan: Hard & Soft Quotas with Superadmin Override

**Branch**: `103-hard-soft-quota-overrides` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-PLAN-02-T01 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Depends on**: US-PLAN-01 (`097-plan-entity-tenant-assignment`, `098-plan-base-limits`), US-OBS-03 (metering infrastructure)
**Input**: Feature specification from `specs/103-hard-soft-quota-overrides/spec.md`

## Summary

Introduce **hard and soft quota enforcement** per dimension per plan, **per-tenant quota overrides** with mandatory justification and optional expiration, and a **runtime enforcement layer** that resolves effective limits (override > plan > catalog default) and applies the correct block-or-grace behavior at resource creation time. Every enforcement decision and override lifecycle event is audited via PostgreSQL rows and Kafka events. This task does NOT cover boolean capabilities (T02), workspace-level sub-quota aggregation (T03), console visualization (T04), gateway/UI enforcement (T05), or end-to-end tests (T06).

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (established in `services/provisioning-orchestrator`)
**Storage**: PostgreSQL — extends `plans` and `quota_dimension_catalog` from 097/098; new tables `quota_overrides`, `quota_enforcement_log`
**Testing**: `node:test` (Node 20 native), `node:assert`, `pg` (fixture queries), `kafkajs` (event verification), `undici` (HTTP contract tests)
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless
**Project Type**: Multi-tenant BaaS platform (web-service)
**Performance Goals**: Effective limit resolution < 20 ms p95; enforcement decision < 50 ms p95 (synchronous in resource creation path); override CRUD < 100 ms p95
**Constraints**: Multi-tenant isolation; enforcement fails closed when metering unavailable; override justification mandatory; single active override per tenant per dimension; audit every lifecycle and enforcement event
**Scale/Scope**: ≥200 tenants, each potentially with overrides across 8+ dimensions; enforcement evaluated on every resource creation request

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | All new logic under `services/provisioning-orchestrator`; migrations in `src/migrations/`; contracts in `specs/103-hard-soft-quota-overrides/contracts/` |
| II. Incremental Delivery | ✅ PASS | Delivers quota type classification + override CRUD + enforcement engine only; console visualization, boolean capabilities, and gateway enforcement deferred to T02–T06 |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; existing `provisioning-orchestrator` deployment pattern applies |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests; root CI scripts extended |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, quickstart.md, and migration SQL constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

## Project Structure

### Documentation (this feature)

```text
specs/103-hard-soft-quota-overrides/
├── plan.md              ← This file
├── spec.md              ← Feature specification (already materialized)
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output (entities, DDL, override schema)
├── quickstart.md        ← Phase 1 output (local dev and test execution)
└── contracts/
    ├── quota-override-create.json         ← Create per-tenant override
    ├── quota-override-modify.json         ← Modify active override
    ├── quota-override-revoke.json         ← Revoke active override
    ├── quota-override-list.json           ← List overrides (filterable)
    ├── quota-effective-limits-get.json    ← Tenant effective limits (resolved)
    └── quota-enforce.json                 ← Enforcement decision contract (internal)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── quota-override-create.mjs          ← NEW: create per-tenant override
│   │   ├── quota-override-modify.mjs          ← NEW: modify active override
│   │   ├── quota-override-revoke.mjs          ← NEW: revoke active override
│   │   ├── quota-override-list.mjs            ← NEW: list overrides (paginated, filterable)
│   │   ├── quota-effective-limits-get.mjs     ← NEW: resolve effective limits for a tenant
│   │   ├── quota-enforce.mjs                  ← NEW: enforcement decision (internal, sync)
│   │   └── quota-override-expiry-sweep.mjs    ← NEW: periodic sweep for expired overrides
│   ├── models/
│   │   ├── quota-override.mjs                 ← NEW: QuotaOverride entity + validation
│   │   └── quota-enforcement.mjs              ← NEW: enforcement decision model (hard/soft/grace logic)
│   ├── repositories/
│   │   ├── quota-override-repository.mjs      ← NEW: override CRUD with optimistic concurrency
│   │   └── quota-enforcement-repository.mjs   ← NEW: enforcement log persistence + effective limit resolution query
│   └── events/
│       ├── quota-override-events.mjs          ← NEW: Kafka events for override lifecycle
│       └── quota-enforcement-events.mjs       ← NEW: Kafka events for enforcement decisions
│   └── migrations/
│       └── 103-hard-soft-quota-overrides.sql  ← NEW: DDL for quota_overrides, plan quota_type metadata extension

tests/
└── integration/
    └── 103-hard-soft-quota-overrides/
        ├── fixtures/
        │   ├── seed-plans-with-quota-types.mjs  ← plans with hard/soft dimension configs
        │   └── seed-overrides.mjs               ← pre-existing overrides for test scenarios
        ├── quota-type-classification.test.mjs   ← US-1: hard vs soft classification per plan
        ├── quota-override-crud.test.mjs         ← US-2, US-3: create/modify/revoke overrides
        ├── quota-enforcement.test.mjs           ← US-4: runtime enforcement decisions
        ├── quota-override-expiry.test.mjs       ← override expiration sweep
        ├── quota-audit.test.mjs                 ← US-5: audit trail completeness
        └── quota-isolation.test.mjs             ← cross-tenant isolation verification
```

**Structure Decision**: Extends `services/provisioning-orchestrator` following the established pattern from 073, 075, 089, 092, 093, 096, 097, 098, and 100. The `plans.quota_dimensions` JSONB column is extended with a parallel `plans.quota_type_config` JSONB column to carry per-dimension hard/soft classification and grace margin metadata.

---

## Phase 0: Research Findings

### R-01 — Hard/Soft Quota Type Storage Strategy

**Decision**: Add a new JSONB column `plans.quota_type_config` that maps `dimension_key → { type: "hard"|"soft", graceMargin?: number }`. The existing `plans.quota_dimensions` continues to store numeric limit values.
**Rationale**: Keeping type/grace metadata separate from numeric limits avoids breaking the T01/T02 contract for `quota_dimensions` (which is `string → number`). The new column is a parallel metadata map with the same dimension keys. If a dimension key is absent from `quota_type_config`, it defaults to `{ type: "hard" }` per FR-005.
**Alternatives considered**: (1) Changing `quota_dimensions` values from numbers to objects `{ value, type, graceMargin }` — rejected because it breaks T01 contract and requires migrating all existing plan data. (2) Normalized `plan_quota_types` junction table — rejected because it introduces dual-write complexity and the data is small and plan-scoped. (3) Storing type info in `quota_dimension_catalog` — rejected because type classification varies per plan, not per dimension globally.

### R-02 — Quota Override Storage Model

**Decision**: Create a new `quota_overrides` table with columns: `id`, `tenant_id`, `dimension_key`, `override_value`, `quota_type` (hard/soft override classification), `grace_margin`, `justification`, `expires_at`, `status` (active/superseded/revoked/expired), `created_by`, `created_at`, `superseded_by`, `revoked_by`, `revoked_at`, `revocation_justification`.
**Rationale**: A dedicated table is cleaner than embedding overrides in tenant metadata or plan JSONB. The `UNIQUE` partial index on `(tenant_id, dimension_key) WHERE status = 'active'` enforces the "single active override" invariant at the database level. The `superseded_by` FK creates a linked chain for audit trail traversal.
**Alternatives considered**: (1) JSONB on `tenant_plan_assignments` — rejected because overrides survive plan changes and need independent lifecycle. (2) Extension of `plan_audit_events` — rejected because overrides are not plan-level events, they're tenant-level.

### R-03 — Effective Limit Resolution Strategy

**Decision**: Resolution is computed at query time with a single SQL query joining `quota_dimension_catalog`, `plans`, `tenant_plan_assignments`, and `quota_overrides`. Resolution order: active override value (if exists) > plan explicit value (from `plans.quota_dimensions`) > catalog default value (from `quota_dimension_catalog.default_value`). Quota type resolution follows the same hierarchy: override quota type > plan quota type config > default hard.
**Rationale**: No materialized view needed given ≤50 dimensions × ≤200 tenants. The join is straightforward and sub-20ms for a single tenant's profile.
**Resolution SQL pattern**:

```sql
SELECT
  c.dimension_key,
  c.display_label,
  c.unit,
  COALESCE(o.override_value, p.quota_dimensions->>c.dimension_key, c.default_value) AS effective_value,
  CASE
    WHEN o.id IS NOT NULL THEN 'override'
    WHEN p.quota_dimensions ? c.dimension_key THEN 'plan'
    ELSE 'default'
  END AS source,
  COALESCE(
    o.quota_type,
    (p.quota_type_config->>c.dimension_key)::jsonb->>'type',
    'hard'
  ) AS effective_quota_type,
  COALESCE(
    o.grace_margin,
    ((p.quota_type_config->>c.dimension_key)::jsonb->>'graceMargin')::int,
    0
  ) AS effective_grace_margin
FROM quota_dimension_catalog c
LEFT JOIN plans p ON p.id = (
  SELECT plan_id FROM tenant_plan_assignments
  WHERE tenant_id = $1 AND is_current = true
)
LEFT JOIN quota_overrides o ON o.tenant_id = $1
  AND o.dimension_key = c.dimension_key
  AND o.status = 'active'
  AND (o.expires_at IS NULL OR o.expires_at > NOW())
```

**Alternatives considered**: (1) Cache effective limits in a materialized view — rejected per incremental delivery; can be added if performance requires. (2) Redis cache layer — rejected: premature optimization for the expected scale.

### R-04 — Enforcement Decision Flow

**Decision**: The enforcement action (`quota-enforce.mjs`) is an internal OpenWhisk action invoked synchronously by resource-creation actions. It accepts `{ tenantId, dimensionKey, currentUsage }`, resolves the effective limit and quota type, and returns `{ allowed: boolean, decision: "allowed"|"hard_blocked"|"soft_grace_allowed"|"soft_grace_exhausted"|"unlimited", warning?: string }`.
**Rationale**: Making enforcement a dedicated internal action allows all resource-creation paths to call the same logic. The action is synchronous (not async) because enforcement must complete before the resource is created.
**Fail-closed behavior**: If the metering system is unreachable (usage cannot be determined), enforcement returns `{ allowed: false, decision: "metering_unavailable" }` with a transient error, per the spec's edge case requirement.
**Alternatives considered**: (1) Inline enforcement in each resource-creation action — rejected: duplicates logic, hard to maintain. (2) APISIX plugin enforcement — deferred to T05, this task implements the core enforcement engine callable from the backend.

### R-05 — Override Concurrency Control

**Decision**: Use `INSERT ... ON CONFLICT (tenant_id, dimension_key) WHERE status = 'active' DO NOTHING` combined with a transaction that first attempts the insert, and if 0 rows affected, returns `409 OVERRIDE_ALREADY_EXISTS`. For superseding, the create action wraps in a transaction: `UPDATE quota_overrides SET status = 'superseded', superseded_by = $newId WHERE tenant_id = $1 AND dimension_key = $2 AND status = 'active'` then `INSERT` the new override.
**Rationale**: The partial unique index enforces the invariant at database level. The two-step transaction ensures exactly one active override per tenant per dimension with a clean supersession chain.
**Alternatives considered**: (1) Optimistic locking with version column — adds complexity without benefit given the partial unique index. (2) Application-level mutex — fragile across OpenWhisk action instances.

### R-06 — Override Expiry Sweep

**Decision**: A scheduled OpenWhisk action `quota-override-expiry-sweep.mjs` runs periodically (configurable, default every 5 minutes) and transitions `status = 'active'` overrides with `expires_at <= NOW()` to `status = 'expired'`. Batch size is configurable (default 100) to avoid long-running transactions.
**Rationale**: Expired overrides are also excluded at query time via `(o.expires_at IS NULL OR o.expires_at > NOW())`, so the sweep is a consistency/cleanup mechanism rather than the primary expiry enforcement. This dual approach ensures real-time correctness (query-time filter) plus clean state (sweep).
**Alternatives considered**: (1) Query-time only (no sweep) — rejected: leaves stale `active` status in the table, complicates override list queries. (2) PostgreSQL scheduled job (pg_cron) — rejected: OpenWhisk scheduling is the established pattern.

### R-07 — Audit Event Strategy

**Decision**: Extend `plan_audit_events` with new `action_type` values for override lifecycle: `quota.override.created`, `quota.override.modified`, `quota.override.revoked`, `quota.override.expired`, `quota.override.superseded`. Enforcement decisions are emitted to Kafka only (not persisted to `plan_audit_events`) to avoid high-volume write amplification. New Kafka topics for enforcement: `console.quota.hard_limit.blocked`, `console.quota.soft_limit.exceeded`. New Kafka topics for override lifecycle: `console.quota.override.created`, `console.quota.override.modified`, `console.quota.override.revoked`, `console.quota.override.expired`.
**Rationale**: Override events are low-volume and belong in the queryable audit table. Enforcement events are high-volume (every resource creation) and are better served as Kafka events for downstream analytics/alerting. The `plan_audit_events` table is reused for override events because they share the same actor/timestamp/tenant audit structure.
**Alternatives considered**: (1) Separate `quota_audit_events` table — rejected: would duplicate the existing audit table pattern; `plan_audit_events` already has the right schema. (2) Persisting enforcement events to PostgreSQL — rejected: write amplification on every resource creation is disproportionate; Kafka provides the event stream, downstream consumers can materialize if needed.

### R-08 — No New Infrastructure

**Decision**: Six new Kafka topics (30d retention), one new PostgreSQL table, one new JSONB column on `plans`. No new Helm charts; no new services. Reuse existing `provisioning-orchestrator` deployment.
**Rationale**: Incremental delivery (Constitution Principle II). The `provisioning-orchestrator` is the established home for plan and quota logic.

---

## Phase 1: Data Model

### Extended Entity: `plans` (from T01/T02)

**New column**:

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `quota_type_config` | `JSONB` | NOT NULL DEFAULT `'{}'::jsonb` | Per-dimension quota type configuration |

**`quota_type_config` schema** (validated at action/repository layer):

```json
{
  "max_workspaces": { "type": "hard" },
  "max_kafka_topics": { "type": "soft", "graceMargin": 5 },
  "max_functions": { "type": "soft", "graceMargin": 10 }
}
```

**Rules**:
- Absent dimension key → defaults to `{ "type": "hard" }` (FR-005)
- `graceMargin` is mandatory when `type = "soft"`, must be a non-negative integer (FR-006)
- `graceMargin = 0` with `type = "soft"` → behaves as hard limit at runtime but classified as soft for reporting (edge case from spec)
- Every key must exist in `quota_dimension_catalog` (catalog validation)
- Mutated via the same lifecycle guard as `quota_dimensions` (draft: unrestricted, active: with audit, deprecated/archived: rejected)

### New Entity: `quota_overrides`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Stable identifier |
| `tenant_id` | `VARCHAR(255)` | NOT NULL | Target tenant |
| `dimension_key` | `VARCHAR(64)` | NOT NULL, FK → `quota_dimension_catalog.dimension_key` | Overridden dimension |
| `override_value` | `BIGINT` | NOT NULL, CHECK >= -1 | Override limit; -1 = unlimited |
| `quota_type` | `VARCHAR(10)` | NOT NULL, CHECK IN (`hard`, `soft`), DEFAULT `'hard'` | Override enforcement type |
| `grace_margin` | `INTEGER` | NOT NULL DEFAULT 0, CHECK >= 0 | Grace margin (relevant when quota_type = soft) |
| `justification` | `TEXT` | NOT NULL, CHECK length > 0 AND length <= 1000 | Mandatory reason from superadmin |
| `expires_at` | `TIMESTAMPTZ` | | Optional expiration; NULL = no expiry |
| `status` | `VARCHAR(20)` | NOT NULL, CHECK IN (`active`, `superseded`, `revoked`, `expired`), DEFAULT `'active'` | Lifecycle status |
| `created_by` | `VARCHAR(255)` | NOT NULL | Actor identity (superadmin) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT NOW() | |
| `superseded_by` | `UUID` | FK → `quota_overrides.id` | Points to the override that replaced this one |
| `revoked_by` | `VARCHAR(255)` | | Actor who revoked |
| `revoked_at` | `TIMESTAMPTZ` | | Revocation timestamp |
| `revocation_justification` | `TEXT` | CHECK length <= 1000 | Reason for revocation |

**Indexes**:
- `UNIQUE (tenant_id, dimension_key) WHERE status = 'active'` — enforces single active override invariant
- `INDEX (tenant_id, status)` — efficient per-tenant active override lookups
- `INDEX (status, expires_at) WHERE status = 'active' AND expires_at IS NOT NULL` — efficient expiry sweep queries
- `INDEX (dimension_key)` — filter by dimension across tenants

**Trigger**: `updated_at` is intentionally omitted — override mutations create new rows (supersede) or update status fields with explicit timestamps (`revoked_at`), not in-place updates of business data.

### Extended Entity: `plan_audit_events` (from T01)

No DDL change. New `action_type` values:

| action_type | Trigger | previous_state | new_state |
|-------------|---------|----------------|-----------|
| `quota.override.created` | New override created | `null` | `{ tenantId, dimensionKey, overrideValue, quotaType, graceMargin, justification, expiresAt }` |
| `quota.override.modified` | Active override modified | `{ overrideValue, quotaType, graceMargin, expiresAt }` | `{ overrideValue, quotaType, graceMargin, expiresAt }` |
| `quota.override.revoked` | Override revoked | `{ overrideValue, status: "active" }` | `{ status: "revoked", revokedBy, revocationJustification }` |
| `quota.override.expired` | Override expired by sweep | `{ overrideValue, status: "active", expiresAt }` | `{ status: "expired" }` |
| `quota.override.superseded` | Override replaced by new one | `{ overrideId, overrideValue }` | `{ supersededBy, newOverrideId }` |
| `plan.quota_type.set` | Dimension quota type set/updated on plan | `{ dimensionKey, previousType?, previousGraceMargin? }` | `{ dimensionKey, type, graceMargin? }` |

### Kafka Topics

| Topic | Retention | Trigger |
|-------|-----------|---------|
| `console.quota.override.created` | 30d | Override created for a tenant |
| `console.quota.override.modified` | 30d | Active override modified |
| `console.quota.override.revoked` | 30d | Override revoked |
| `console.quota.override.expired` | 30d | Override expired (by sweep or query-time detection) |
| `console.quota.hard_limit.blocked` | 30d | Hard limit enforcement blocked a resource creation |
| `console.quota.soft_limit.exceeded` | 30d | Soft limit exceeded (grace zone entry or grace exhausted block) |

**Kafka event envelope** (follows platform audit event pattern):

```json
{
  "eventType": "console.quota.override.created",
  "correlationId": "<uuid>",
  "actorId": "<superadmin>",
  "tenantId": "<tenant>",
  "dimensionKey": "max_pg_databases",
  "timestamp": "<ISO8601>",
  "payload": {
    "overrideId": "<uuid>",
    "overrideValue": 10,
    "quotaType": "hard",
    "graceMargin": 0,
    "justification": "Enterprise pilot, approved by VP Sales",
    "expiresAt": "2026-04-15T00:00:00Z"
  }
}
```

**Enforcement event envelope**:

```json
{
  "eventType": "console.quota.hard_limit.blocked",
  "correlationId": "<uuid>",
  "tenantId": "<tenant>",
  "workspaceId": "<workspace>",
  "dimensionKey": "max_workspaces",
  "timestamp": "<ISO8601>",
  "payload": {
    "currentUsage": 3,
    "effectiveLimit": 3,
    "effectiveQuotaType": "hard",
    "source": "plan",
    "decision": "hard_blocked",
    "attemptedAction": "workspace.create"
  }
}
```

---

## Phase 1: Action Contracts (Summary)

Full JSON contract files are generated in `specs/103-hard-soft-quota-overrides/contracts/`.

### `quota-override-create`

- **Auth**: superadmin JWT
- **Input**: `{ tenantId, dimensionKey, overrideValue, quotaType?, graceMargin?, justification, expiresAt? }`
  - `overrideValue`: integer ≥ -1
  - `quotaType`: `"hard"` (default) or `"soft"`
  - `graceMargin`: required if `quotaType = "soft"`, non-negative integer
  - `justification`: 1–1000 chars, mandatory
  - `expiresAt`: optional ISO8601 timestamp, must be in the future
- **Behavior**: If an active override already exists for the same tenant + dimension, it is superseded (status → `superseded`, `superseded_by` → new override id)
- **Output (201)**:

  ```json
  {
    "overrideId": "<uuid>",
    "tenantId": "acme-corp",
    "dimensionKey": "max_pg_databases",
    "overrideValue": 10,
    "quotaType": "hard",
    "graceMargin": 0,
    "justification": "Enterprise pilot, approved by VP Sales",
    "expiresAt": "2026-04-15T00:00:00Z",
    "status": "active",
    "supersededOverrideId": "<uuid>|null",
    "createdAt": "<ISO8601>",
    "createdBy": "<actor>"
  }
  ```

- **Errors**: `400 INVALID_DIMENSION_KEY`, `400 INVALID_OVERRIDE_VALUE`, `400 JUSTIFICATION_REQUIRED`, `400 GRACE_MARGIN_REQUIRED_FOR_SOFT`, `400 EXPIRATION_MUST_BE_FUTURE`, `404 TENANT_NOT_FOUND`, `403 FORBIDDEN`

### `quota-override-modify`

- **Auth**: superadmin JWT
- **Input**: `{ overrideId, overrideValue?, quotaType?, graceMargin?, expiresAt?, justification }`
  - At least one of `overrideValue`, `quotaType`, `graceMargin`, `expiresAt` must change
  - `justification`: mandatory for modification (captures reason for change)
- **Output (200)**:

  ```json
  {
    "overrideId": "<uuid>",
    "tenantId": "acme-corp",
    "dimensionKey": "max_api_keys",
    "previousState": {
      "overrideValue": 100,
      "quotaType": "hard",
      "graceMargin": 0,
      "expiresAt": "2026-06-01T00:00:00Z"
    },
    "newState": {
      "overrideValue": 150,
      "quotaType": "hard",
      "graceMargin": 0,
      "expiresAt": "2026-09-01T00:00:00Z"
    },
    "justification": "Extended pilot period",
    "modifiedAt": "<ISO8601>",
    "modifiedBy": "<actor>"
  }
  ```

- **Errors**: `404 OVERRIDE_NOT_FOUND`, `409 OVERRIDE_NOT_ACTIVE`, `400 NO_CHANGES_SPECIFIED`, `400 JUSTIFICATION_REQUIRED`, `403 FORBIDDEN`

### `quota-override-revoke`

- **Auth**: superadmin JWT
- **Input**: `{ overrideId, justification }`
- **Output (200)**:

  ```json
  {
    "overrideId": "<uuid>",
    "tenantId": "acme-corp",
    "dimensionKey": "max_functions",
    "revokedValue": 200,
    "effectiveValueAfterRevocation": 50,
    "effectiveSource": "plan",
    "justification": "Pilot concluded",
    "revokedAt": "<ISO8601>",
    "revokedBy": "<actor>"
  }
  ```

- **Errors**: `404 OVERRIDE_NOT_FOUND`, `409 OVERRIDE_NOT_ACTIVE`, `400 JUSTIFICATION_REQUIRED`, `403 FORBIDDEN`

### `quota-override-list`

- **Auth**: superadmin JWT
- **Input**: `{ tenantId?, dimensionKey?, status?, page?, pageSize? }`
  - All filters optional; defaults to all active overrides, page 1, size 50
- **Output (200)**:

  ```json
  {
    "overrides": [
      {
        "overrideId": "<uuid>",
        "tenantId": "acme-corp",
        "dimensionKey": "max_pg_databases",
        "overrideValue": 10,
        "quotaType": "hard",
        "graceMargin": 0,
        "justification": "Enterprise pilot",
        "expiresAt": "2026-04-15T00:00:00Z",
        "status": "active",
        "createdAt": "<ISO8601>",
        "createdBy": "<actor>"
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 50
  }
  ```

- **Errors**: `403 FORBIDDEN`

### `quota-effective-limits-get`

- **Auth**: superadmin JWT (any tenant) or tenant owner JWT (own tenant only)
- **Input**: `{ tenantId }`
- **Output (200)**:

  ```json
  {
    "tenantId": "acme-corp",
    "planSlug": "professional",
    "planStatus": "active",
    "effectiveLimits": [
      {
        "dimensionKey": "max_workspaces",
        "displayLabel": "Maximum Workspaces",
        "unit": "count",
        "effectiveValue": 10,
        "source": "override",
        "quotaType": "hard",
        "graceMargin": 0,
        "unlimitedSentinel": false,
        "overrideMetadata": {
          "overrideId": "<uuid>",
          "expiresAt": "2026-06-01T00:00:00Z",
          "justification": "Enterprise pilot"
        }
      },
      {
        "dimensionKey": "max_kafka_topics",
        "displayLabel": "Maximum Kafka Topics",
        "unit": "count",
        "effectiveValue": 20,
        "source": "plan",
        "quotaType": "soft",
        "graceMargin": 5,
        "unlimitedSentinel": false,
        "overrideMetadata": null
      },
      {
        "dimensionKey": "max_functions",
        "displayLabel": "Maximum Functions",
        "unit": "count",
        "effectiveValue": 50,
        "source": "default",
        "quotaType": "hard",
        "graceMargin": 0,
        "unlimitedSentinel": false,
        "overrideMetadata": null
      }
    ]
  }
  ```

- **Tenant owner view**: `overrideMetadata` is **excluded** (only superadmins see override justification/actor details)
- **No-plan case**: `{ "tenantId": "acme-corp", "noAssignment": true, "effectiveLimits": [] }`
- **Errors**: `403 FORBIDDEN`, `404 TENANT_NOT_FOUND`

### `quota-enforce` (Internal Action)

- **Auth**: Internal action invocation (service-to-service, no external JWT required)
- **Input**: `{ tenantId, workspaceId, dimensionKey, currentUsage, attemptedAction }`
- **Output (200)**:

  ```json
  {
    "allowed": true,
    "decision": "soft_grace_allowed",
    "effectiveLimit": 20,
    "quotaType": "soft",
    "graceMargin": 5,
    "effectiveCeiling": 25,
    "currentUsage": 21,
    "source": "plan",
    "warning": "Soft quota exceeded for max_kafka_topics. Usage 21/20 (grace ceiling: 25)."
  }
  ```

- **Decision values**: `"allowed"` (under limit), `"hard_blocked"` (hard limit reached), `"soft_grace_allowed"` (soft limit exceeded, within grace), `"soft_grace_exhausted"` (soft limit + grace reached), `"unlimited"` (dimension is -1), `"metering_unavailable"` (fail-closed)
- **Response headers** (propagated by calling action): `X-Quota-Warning` header when `decision = "soft_grace_allowed"`
- **Errors**: `500 METERING_UNAVAILABLE` (transient, fail-closed)

---

## Testing Strategy

### Unit Tests

- `quota-override.mjs` model: validation of override value (≥-1, integer), justification length (1–1000), expiration must be future, grace margin required when quota type is soft, status transitions (active→superseded, active→revoked, active→expired)
- `quota-enforcement.mjs` model: decision logic for hard/soft/grace/unlimited/fail-closed scenarios, edge case of graceMargin=0 with soft type

### Integration Tests (node:test)

#### `quota-type-classification.test.mjs`

- Set a plan's `quota_type_config` with one hard and one soft dimension, verify persisted correctly (FR-001)
- Default behavior: dimension absent from `quota_type_config` treated as hard (FR-005)
- Soft dimension without grace margin rejected (FR-006)
- Grace margin = 0 accepted for soft dimension (edge case)
- Lifecycle guard: setting quota type on deprecated/archived plan rejected with `409`

#### `quota-override-crud.test.mjs`

- Create override for a tenant: persisted with justification, status = active (FR-007, FR-008, FR-009)
- Create override without justification: `400 JUSTIFICATION_REQUIRED` (FR-008)
- Create override for same tenant+dimension supersedes previous (FR-010)
- Create override with expiration in the past: `400 EXPIRATION_MUST_BE_FUTURE` (FR-011)
- Modify override value and expiration: previous state captured in audit (FR-014)
- Revoke override: status → revoked, effective limit reverts to plan base (FR-013)
- List overrides filtered by tenant: returns only that tenant's overrides (FR-018)
- List overrides filtered by dimension: returns cross-tenant results for superadmin (FR-018)
- Concurrent override creation for same tenant+dimension: exactly one succeeds (R-05)

#### `quota-enforcement.test.mjs`

- Hard limit at threshold: blocked with `QUOTA_HARD_LIMIT_REACHED` (FR-002, US-4 scenario 1)
- Hard limit below threshold: allowed (US-4 baseline)
- Soft limit at base exceeded, within grace: allowed with warning event (FR-003, US-4 scenario 2)
- Soft limit at grace exhausted: blocked with `QUOTA_SOFT_LIMIT_GRACE_EXHAUSTED` (FR-004, US-4 scenario 3)
- Override raises limit: enforcement uses override value (US-4 scenario 4)
- Unlimited dimension (-1): no quota check performed (FR-022, US-4 scenario 5)
- Metering unavailable: fail-closed with transient error (edge case)
- Grace margin = 0 on soft dimension: behaves as hard limit at runtime (edge case)

#### `quota-override-expiry.test.mjs`

- Override with past expiration: sweep transitions to expired status (FR-012)
- Override with future expiration: not touched by sweep
- Expired override excluded from effective limit resolution (FR-011, R-06)
- Multiple expired overrides processed in single sweep batch

#### `quota-audit.test.mjs`

- Override creation produces `plan_audit_events` row + Kafka event (FR-016)
- Override modification produces audit row with previous and new state (FR-016)
- Override revocation produces audit row with justification (FR-016)
- Hard limit block emits `console.quota.hard_limit.blocked` Kafka event (FR-017)
- Soft grace entry emits `console.quota.soft_limit.exceeded` Kafka event (FR-017)
- Audit queryable by tenant, dimension, and time range (FR-016)

#### `quota-isolation.test.mjs`

- Tenant A's overrides invisible to tenant B's queries (FR-021)
- Tenant owner can query own effective limits but not override metadata (FR-019, FR-020)
- Tenant owner cannot create/modify/revoke overrides (FR-020)

### Contract Tests

- Validate OpenWhisk action response shapes against JSON schemas in `contracts/`
- Verify error codes for all rejection scenarios

### Observability Validation

- Kafka event emission verified in integration tests via `kafkajs` consumer with 5s timeout
- `plan_audit_events` rows verified via `pg` direct query assertions
- Override expiry sweep verified via time-manipulation fixtures

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race between concurrent override creations for same tenant+dimension | Medium | Medium | Partial unique index `(tenant_id, dimension_key) WHERE status = 'active'` + transaction-level supersede-then-insert (R-05) |
| Enforcement latency exceeds 50 ms p95 under load | Low | High | Resolution query is a single join with indexed lookups; no materialization needed at expected scale; add monitoring and cache layer as follow-on if needed |
| Metering service unavailable causes resource creation failures | Medium | High | Fail-closed behavior with clear transient error code; documented in contract; retry is caller's responsibility |
| Expired overrides briefly appear active between sweep cycles | Low | Low | Query-time filter `(expires_at IS NULL OR expires_at > NOW())` ensures correct enforcement regardless of sweep timing (R-06) |
| `plans.quota_type_config` JSONB grows inconsistently with `quota_dimensions` | Medium | Medium | Repository layer validates both columns' keys against catalog on every write; action layer rejects unknown keys |
| Kafka publish failure after DB commit for override events | Low | Low | Fire-and-forget (platform pattern); `plan_audit_events` row is the durable audit record; Kafka failure does not roll back |
| Override value lower than current usage at creation time | Low | Medium | Override is accepted (it's an administrative decision); enforcement will block future creations but does NOT retroactively remove existing resources. Document this behavior. |
| Plan change (upgrade/downgrade) while overrides are active | Low | Medium | Overrides survive plan changes per spec; effective limit is recalculated dynamically using the new plan's base limits. Override value itself is immutable relative to plan changes. |

---

## Dependencies & Sequencing

### Prerequisites

- **US-PLAN-01-T01** (`097-plan-entity-tenant-assignment`): `plans` table, `plan_audit_events` table, `tenant_plan_assignments` table must be in place.
- **US-PLAN-01-T02** (`098-plan-base-limits`): `quota_dimension_catalog` table with 8 seeded dimensions, `plans.quota_dimensions` JSONB semantics established.
- **US-OBS-03** (metering infrastructure): Provides `currentUsage` counters per tenant per dimension. The enforcement action depends on this for runtime decisions. If not yet available, enforcement tests can mock the metering interface.
- **Migration ordering**: `103-hard-soft-quota-overrides.sql` must run after `098-plan-base-limits.sql`.

### Parallelizable Work

- `quota_overrides` DDL + migration can be developed in parallel with override repository and model
- Override CRUD actions can be developed in parallel with enforcement action (enforcement depends on repository but not on CRUD actions)
- Contract JSON files and integration test fixtures can be prepared before actions are complete
- `plans.quota_type_config` column addition can be done in the same migration as the new table

### Recommended Implementation Sequence

1. Write and apply migration `103-hard-soft-quota-overrides.sql` (new `quota_overrides` table, `plans.quota_type_config` column, indexes)
2. Implement `quota-override.mjs` model + `quota-enforcement.mjs` model (validation, decision logic)
3. Implement `quota-override-repository.mjs` (CRUD with concurrency control, supersede logic)
4. Implement `quota-enforcement-repository.mjs` (effective limit resolution query)
5. Implement `quota-override-events.mjs` + `quota-enforcement-events.mjs` (Kafka event emission)
6. Implement `quota-override-create.mjs`, `quota-override-modify.mjs`, `quota-override-revoke.mjs` actions
7. Implement `quota-override-list.mjs` action
8. Implement `quota-effective-limits-get.mjs` action
9. Implement `quota-enforce.mjs` action (internal enforcement engine)
10. Implement `quota-override-expiry-sweep.mjs` action
11. Write contract JSON files in `specs/103-hard-soft-quota-overrides/contracts/`
12. Write integration tests; run against local PostgreSQL + Kafka fixtures
13. Update `AGENTS.md` with new env vars, Kafka topics, and table descriptions

### New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED` | `console.quota.override.created` | Kafka topic for override creation events |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED` | `console.quota.override.modified` | Kafka topic for override modification events |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED` | `console.quota.override.revoked` | Kafka topic for override revocation events |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED` | `console.quota.override.expired` | Kafka topic for override expiry events |
| `QUOTA_ENFORCEMENT_KAFKA_TOPIC_HARD_BLOCKED` | `console.quota.hard_limit.blocked` | Kafka topic for hard limit enforcement blocks |
| `QUOTA_ENFORCEMENT_KAFKA_TOPIC_SOFT_EXCEEDED` | `console.quota.soft_limit.exceeded` | Kafka topic for soft limit grace zone entries |
| `QUOTA_OVERRIDE_EXPIRY_SWEEP_INTERVAL_MS` | `300000` | Expiry sweep interval (default 5 min) |
| `QUOTA_OVERRIDE_EXPIRY_SWEEP_BATCH_SIZE` | `100` | Max overrides processed per sweep cycle |
| `QUOTA_OVERRIDE_JUSTIFICATION_MAX_LENGTH` | `1000` | Max chars for override justification |
| `QUOTA_ENFORCEMENT_LOCK_TIMEOUT_MS` | `5000` | Timeout for SELECT FOR UPDATE in enforcement resolution |

---

## Criteria of Done

| ID | Criterion | Evidence |
|----|-----------|---------|
| DOD-01 | Migration `103-hard-soft-quota-overrides.sql` applied cleanly to a fresh DB (after 098) | `psql` schema dump shows `quota_overrides` table and `plans.quota_type_config` column |
| DOD-02 | A plan can have dimensions classified as hard or soft with per-dimension grace margin | `quota-type-classification.test.mjs` assertions |
| DOD-03 | Default quota type is hard when not explicitly configured (FR-005) | `quota-type-classification.test.mjs` assertion |
| DOD-04 | Override CRUD: create with mandatory justification, modify, revoke — all persisted and audited (FR-007–FR-014, FR-016) | `quota-override-crud.test.mjs` assertions |
| DOD-05 | Single active override per tenant per dimension enforced at DB level (FR-010) | `quota-override-crud.test.mjs` concurrent test + DB unique index |
| DOD-06 | Override expiration: expired overrides excluded from effective limits within one sweep cycle (FR-011, FR-012) | `quota-override-expiry.test.mjs` assertions |
| DOD-07 | Effective limit resolution: override > plan > catalog default hierarchy correct (FR-015) | `quota-enforcement.test.mjs` + `quota-effective-limits-get` response assertions |
| DOD-08 | Hard enforcement: blocks at limit with `QUOTA_HARD_LIMIT_REACHED` (FR-002) | `quota-enforcement.test.mjs` hard_blocked scenario |
| DOD-09 | Soft enforcement: allows within grace with warning event; blocks when grace exhausted (FR-003, FR-004) | `quota-enforcement.test.mjs` soft_grace_allowed + soft_grace_exhausted scenarios |
| DOD-10 | Unlimited sentinel (-1) skips quota check entirely (FR-022) | `quota-enforcement.test.mjs` unlimited scenario |
| DOD-11 | Fail-closed on metering unavailability | `quota-enforcement.test.mjs` metering_unavailable scenario |
| DOD-12 | All override lifecycle events and enforcement decisions emitted to correct Kafka topics (FR-016, FR-017) | `quota-audit.test.mjs` Kafka consumer assertions |
| DOD-13 | Override audit records queryable by tenant, dimension, time range (FR-016) | `quota-audit.test.mjs` query assertions |
| DOD-14 | Tenant isolation: no cross-tenant data leakage in overrides or effective limits (FR-021) | `quota-isolation.test.mjs` assertions |
| DOD-15 | Tenant owner can view effective limits but not override metadata (FR-019, FR-020) | `quota-isolation.test.mjs` assertions |
| DOD-16 | Contract JSON files present for all 6 action contracts | Files exist in `specs/103-hard-soft-quota-overrides/contracts/` |
| DOD-17 | `data-model.md` and `quickstart.md` present and accurate | Files present in `specs/103-hard-soft-quota-overrides/` |
| DOD-18 | `AGENTS.md` updated with new env vars, Kafka topics, and table descriptions | `AGENTS.md` diff includes new section |
| DOD-19 | Unrelated untracked artifacts preserved | `git status` confirms `specs/070-*/plan.md`, `specs/070-*/tasks.md`, `specs/072-*/tasks.md` untracked and unmodified |

---

## Complexity Tracking

No constitution violations. No complexity exceptions required. One new table, one new JSONB column, seven new actions, six new Kafka topics — all within the established `provisioning-orchestrator` footprint.
