# Implementation Plan: Plan Boolean Capabilities

**Branch**: `104-plan-boolean-capabilities` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-PLAN-02-T02 | **Epic**: EP-19 | **Story**: US-PLAN-02
**Depends on**: US-PLAN-01 (`097-plan-entity-tenant-assignment`, `098-plan-base-limits`), US-PLAN-02-T01 (`103-hard-soft-quota-overrides`)
**Input**: Feature specification from `specs/104-plan-boolean-capabilities/spec.md`

## Summary

Introduce a **governed boolean capability catalog** (analogous to `quota_dimension_catalog` for numeric quotas), **per-plan capability configuration APIs**, a **plan capability profile query** (superadmin), a **tenant effective capabilities query** (tenant owner, read-only), and full **audit trail + Kafka event emission** for every capability change. The existing `plans.capabilities` JSONB column is retained as the persistence mechanism but is now validated against the catalog. This task does NOT cover numeric quotas (T01), workspace-level sub-quota aggregation (T03), console visualization (T04), gateway/UI enforcement of capabilities (T05), or end-to-end enforcement tests (T06).

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (established in `services/provisioning-orchestrator`)
**Storage**: PostgreSQL — extends existing `plans.capabilities` JSONB from 097; new table `boolean_capability_catalog`
**Testing**: `node:test` (Node 20 native), `node:assert`, `pg` (fixture queries), `kafkajs` (event verification), `undici` (HTTP contract tests)
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless
**Project Type**: Multi-tenant BaaS platform (web-service)
**Performance Goals**: Capability profile resolution < 10 ms p95; catalog query < 5 ms p95; capability CRUD < 50 ms p95
**Constraints**: Multi-tenant isolation; catalog-validated keys only; audit every lifecycle event; capabilities are strictly boolean (on/off)
**Scale/Scope**: ≥200 tenants; 7+ recognized capability keys; capabilities per plan evaluated on every capability profile query

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | All new logic under `services/provisioning-orchestrator`; migrations in `src/migrations/`; contracts in `specs/104-plan-boolean-capabilities/contracts/` |
| II. Incremental Delivery | ✅ PASS | Delivers capability catalog + per-plan capability CRUD + profile queries + audit only; enforcement deferred to T05; console deferred to T04 |
| III. K8s / OpenShift Compatibility | ✅ PASS | No new Helm charts; existing `provisioning-orchestrator` deployment pattern applies |
| IV. Quality Gates | ✅ PASS | New `node:test` integration tests; root CI scripts extended |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, and migration SQL constitute the documentation deliverable |

**No complexity violations.** No new top-level folders; no new frameworks introduced.

## Project Structure

### Documentation (this feature)

```text
specs/104-plan-boolean-capabilities/
├── plan.md              ← This file
├── spec.md              ← Feature specification (already materialized)
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output (entities, DDL, catalog schema)
└── contracts/
    ├── capability-catalog-list.json              ← List recognized capabilities
    ├── plan-capability-set.json                  ← Enable/disable capabilities on a plan
    ├── plan-capability-profile-get.json          ← Full capability profile for a plan (superadmin)
    ├── tenant-effective-capabilities-get.json    ← Tenant effective capabilities (tenant owner)
    └── plan-capability-audit-query.json          ← Query capability change audit trail
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   ├── capability-catalog-list.mjs            ← NEW: list all recognized boolean capabilities
│   │   ├── plan-capability-set.mjs                ← NEW: enable/disable capabilities on a plan
│   │   ├── plan-capability-profile-get.mjs        ← NEW: full capability profile for a plan
│   │   ├── tenant-effective-capabilities-get.mjs  ← NEW: tenant's effective capabilities (read-only)
│   │   └── plan-capability-audit-query.mjs        ← NEW: query capability change audit trail
│   ├── models/
│   │   └── boolean-capability.mjs                 ← NEW: capability catalog entry + validation
│   ├── repositories/
│   │   ├── boolean-capability-catalog-repository.mjs  ← NEW: catalog CRUD + key validation
│   │   └── plan-capability-repository.mjs             ← NEW: per-plan capability configuration persistence
│   └── events/
│       └── plan-capability-events.mjs             ← NEW: Kafka events for capability lifecycle
│   └── migrations/
│       └── 104-plan-boolean-capabilities.sql      ← NEW: DDL for boolean_capability_catalog table

tests/
└── integration/
    └── 104-plan-boolean-capabilities/
        ├── fixtures/
        │   ├── seed-capability-catalog.mjs          ← seed recognized capabilities
        │   └── seed-plans-with-capabilities.mjs     ← plans with various capability configs
        ├── capability-catalog.test.mjs              ← US-2: catalog query and validation
        ├── plan-capability-crud.test.mjs            ← US-1: enable/disable capabilities per plan
        ├── plan-capability-profile.test.mjs         ← US-3: full capability profile query
        ├── tenant-effective-capabilities.test.mjs   ← US-4: tenant-facing capability query
        ├── capability-audit.test.mjs                ← US-5: audit trail completeness
        └── capability-isolation.test.mjs            ← cross-tenant isolation verification
```

**Structure Decision**: Extends `services/provisioning-orchestrator` following the established pattern from 097, 098, 100, and 103. The existing `plans.capabilities` JSONB column is reused — it already stores `{ capabilityKey: boolean }` maps. The new `boolean_capability_catalog` table provides the governance layer that was previously absent.

---

## Phase 0: Research Findings

### R-01 — Existing Capability Infrastructure

**Finding**: The `plans` table already has a `capabilities JSONB NOT NULL DEFAULT '{}'::jsonb` column (from migration 097). The `Plan` model constructor accepts a `capabilities` parameter and validates it as a boolean map (`validateBooleanMap`). The `plan-create.mjs` and `plan-update.mjs` actions already persist capabilities. The `effective-entitlements-repository.mjs` already resolves capabilities by merging plan capabilities with `capability_overrides` from `tenant_plan_adjustments`.
**Impact**: No new column on `plans` is needed. The storage mechanism is already in place. What's missing is the **governed catalog** that validates capability keys, provides display metadata, and defines platform defaults — plus the dedicated admin/query APIs and audit trail.

### R-02 — Distinction from `capability_catalog_metadata` (migration 090)

**Finding**: Migration 090 created a `capability_catalog_metadata` table for *workspace-level* capabilities (postgres-database, mongo-collection, kafka-events, etc.). These are provisioning/infrastructure capabilities that describe what workspace resources can be created. The boolean capabilities in this task are **product-plan-level** capabilities that govern qualitative features of the platform (SQL admin API access, realtime subscriptions as a feature toggle, webhooks, etc.). These are distinct concepts:
- `capability_catalog_metadata` (090): "What types of resources can a workspace contain?"
- `boolean_capability_catalog` (104): "What platform features does a plan unlock?"
**Decision**: Create a separate `boolean_capability_catalog` table. Do NOT reuse or extend `capability_catalog_metadata` — the domains are orthogonal.

### R-03 — Capability Key Namespace

**Decision**: Capability keys use snake_case, max 64 characters, matching the `quota_dimension_catalog.dimension_key` pattern. The initial seed set from the spec is: `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`.
**Rationale**: Consistent naming with the quota dimension catalog. Human-readable keys that map clearly to platform features.

### R-04 — Platform Default Semantics

**Decision**: Each catalog entry carries a `platform_default` boolean (default `false`). When a plan does not explicitly set a capability, the effective state is the catalog's platform default. This allows the platform to add new capabilities that default to disabled (most cases) or enabled (rare, for grandfathered features) without requiring plan modifications.
**Rationale**: Directly implements FR-004 and FR-016 from the spec. The merge logic is: explicit plan setting > catalog platform default.

### R-05 — Orphaned Capability Handling

**Decision**: If a capability key is removed from the catalog (soft-deleted via `is_active = false`), plans that still reference it in their `capabilities` JSONB are not modified. When querying a plan's capability profile, orphaned keys are flagged with `status: "orphaned"` and excluded from enforcement effect. The profile query performs a LEFT JOIN between the catalog and the plan's capability keys to detect orphans.
**Rationale**: Implements FR-017. Non-destructive degradation — admins are informed and can clean up at their convenience.

### R-06 — No-Op Change Detection

**Decision**: When setting a capability to its current value (e.g., enabling an already-enabled capability), the action detects the no-op and returns `200` with `{ changed: false }` — no audit event is emitted, no Kafka event is published, no database write occurs.
**Rationale**: Implements FR-010. Avoids audit noise and unnecessary writes.

### R-07 — Concurrency Control

**Decision**: Use the same optimistic concurrency pattern as `plan-update.mjs`. Capability changes go through `UPDATE plans SET capabilities = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND updated_at = $4`. If 0 rows affected, return `409 CONFLICT`.
**Rationale**: The existing plan update mechanism already handles this. Capabilities are a field on the plan — concurrent modifications to the same plan are serialized by the plan's `updated_at` optimistic lock.

### R-08 — Audit Event Strategy

**Decision**: Extend `plan_audit_events` with new `action_type` values: `plan.capability.enabled` and `plan.capability.disabled`. Each event records the plan, capability key, previous state, and new state. For bulk capability changes (multiple capabilities in a single request), emit one audit event per capability changed.
**Rationale**: Reuses existing audit infrastructure. Per-capability granularity matches the audit requirement from FR-009 and US-5.

### R-09 — Kafka Event Strategy

**Decision**: Two new Kafka topics: `console.plan.capability.enabled` and `console.plan.capability.disabled`. Each event follows the platform audit event envelope pattern. Batch capability changes emit one Kafka event per changed capability.
**Rationale**: Consistent with the established Kafka event patterns from 097, 098, 100, and 103. Downstream consumers can subscribe to specific capability lifecycle events.

### R-10 — No New Infrastructure

**Decision**: One new PostgreSQL table, two new Kafka topics (30d retention). No new Helm charts; no new services. Reuse existing `provisioning-orchestrator` deployment.
**Rationale**: Incremental delivery (Constitution Principle II).

---

## Phase 1: Data Model

### New Entity: `boolean_capability_catalog`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Stable identifier |
| `capability_key` | `VARCHAR(64)` | NOT NULL, UNIQUE | Canonical capability identifier (snake_case) |
| `display_label` | `VARCHAR(255)` | NOT NULL | Human-readable label (e.g., "SQL Admin API") |
| `description` | `TEXT` | NOT NULL | What this capability controls |
| `platform_default` | `BOOLEAN` | NOT NULL, DEFAULT `false` | Default state when plan does not explicitly set this capability |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Soft-delete flag; `false` = removed from catalog (orphaned handling) |
| `sort_order` | `INTEGER` | NOT NULL, DEFAULT `0` | Display ordering in catalog/profile queries |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | |

**Indexes**:
- `UNIQUE (capability_key)` — enforced by column constraint
- `INDEX (is_active, sort_order)` — efficient active catalog queries

**Trigger**: `updated_at` auto-set via `set_updated_at_timestamp()` trigger (same pattern as `quota_dimension_catalog`).

**Seed data** (7 initial capabilities per FR-002):

| `capability_key` | `display_label` | `description` | `platform_default` | `sort_order` |
|---|---|---|---|---|
| `sql_admin_api` | SQL Admin API | Enables direct SQL admin access to the tenant's PostgreSQL databases | `false` | `10` |
| `passthrough_admin` | Passthrough Admin Proxy | Enables the passthrough admin proxy for direct database management | `false` | `20` |
| `realtime` | Realtime Subscriptions | Enables WebSocket-based realtime subscription channels | `false` | `30` |
| `webhooks` | Outbound Webhooks | Enables outbound webhook delivery for event notifications | `false` | `40` |
| `public_functions` | Public Serverless Functions | Enables public HTTP endpoints for serverless functions | `false` | `50` |
| `custom_domains` | Custom Domains | Enables custom domain configuration for tenant endpoints | `false` | `60` |
| `scheduled_functions` | Scheduled Functions | Enables cron-scheduled execution of serverless functions | `false` | `70` |

### Existing Entity: `plans` (from 097)

**No DDL change.** The existing `capabilities JSONB NOT NULL DEFAULT '{}'::jsonb` column is reused. The key difference is behavioral: the `plan-capability-set.mjs` action now validates all capability keys against `boolean_capability_catalog` before persisting. The `Plan` model's `validateBooleanMap` continues to enforce that values are booleans; catalog key validation is added at the action/repository layer.

**`capabilities` JSONB schema** (unchanged from 097):

```json
{
  "sql_admin_api": true,
  "realtime": true,
  "webhooks": true,
  "public_functions": false
}
```

**Rules**:
- Absent capability key → inherits `platform_default` from catalog (FR-004)
- Explicitly set `false` → explicitly disabled (distinct from absent/default)
- Every key must exist in `boolean_capability_catalog` with `is_active = true` (FR-005)
- Mutated via the same lifecycle guard as `quota_dimensions`: draft = unrestricted, active = with audit, deprecated = with audit, archived = blocked (FR-011)

### Existing Entity: `plan_audit_events` (from 097)

No DDL change. New `action_type` values:

| action_type | Trigger | previous_state | new_state |
|-------------|---------|----------------|-----------|
| `plan.capability.enabled` | Capability enabled on plan | `{ capabilityKey, previousState: false\|null }` | `{ capabilityKey, newState: true }` |
| `plan.capability.disabled` | Capability disabled on plan | `{ capabilityKey, previousState: true\|null }` | `{ capabilityKey, newState: false }` |

Where `previousState: null` means the capability was previously unset (inheriting platform default).

### Kafka Topics

| Topic | Retention | Trigger |
|-------|-----------|---------|
| `console.plan.capability.enabled` | 30d | A capability is explicitly enabled on a plan |
| `console.plan.capability.disabled` | 30d | A capability is explicitly disabled on a plan |

**Kafka event envelope** (follows platform audit event pattern):

```json
{
  "eventType": "console.plan.capability.enabled",
  "correlationId": "<uuid>",
  "actorId": "<superadmin>",
  "planId": "<uuid>",
  "planSlug": "professional",
  "timestamp": "<ISO8601>",
  "payload": {
    "capabilityKey": "realtime",
    "displayLabel": "Realtime Subscriptions",
    "previousState": null,
    "newState": true
  }
}
```

---

## Phase 1: Action Contracts (Summary)

Full JSON contract files are generated in `specs/104-plan-boolean-capabilities/contracts/`.

### `capability-catalog-list`

- **Auth**: superadmin JWT
- **Input**: `{ includeInactive? }` — optional, defaults to `false`
- **Output (200)**:

  ```json
  {
    "capabilities": [
      {
        "capabilityKey": "sql_admin_api",
        "displayLabel": "SQL Admin API",
        "description": "Enables direct SQL admin access to the tenant's PostgreSQL databases",
        "platformDefault": false,
        "isActive": true,
        "sortOrder": 10
      }
    ],
    "total": 7
  }
  ```

- **Errors**: `403 FORBIDDEN`

### `plan-capability-set`

- **Auth**: superadmin JWT
- **Input**: `{ planId, capabilities: { capabilityKey: boolean, ... } }`
  - Each key must exist in `boolean_capability_catalog` with `is_active = true`
  - Values must be booleans
  - At least one capability must be specified
- **Behavior**:
  - Merges provided capabilities into the plan's existing `capabilities` JSONB
  - Detects no-op changes per FR-010; only changed capabilities trigger audit/Kafka events
  - Validates plan lifecycle: draft/active/deprecated allowed, archived blocked
  - Uses optimistic concurrency via `updated_at` check
- **Output (200)**:

  ```json
  {
    "planId": "<uuid>",
    "planSlug": "professional",
    "changed": [
      {
        "capabilityKey": "realtime",
        "previousState": null,
        "newState": true
      },
      {
        "capabilityKey": "webhooks",
        "previousState": false,
        "newState": true
      }
    ],
    "unchanged": ["sql_admin_api"],
    "effectiveCapabilities": {
      "sql_admin_api": true,
      "passthrough_admin": false,
      "realtime": true,
      "webhooks": true,
      "public_functions": false,
      "custom_domains": false,
      "scheduled_functions": false
    }
  }
  ```

- **Errors**: `400 INVALID_CAPABILITY_KEY` (key not in catalog), `400 INVALID_CAPABILITY_VALUE` (value not boolean), `400 NO_CAPABILITIES_SPECIFIED`, `404 PLAN_NOT_FOUND`, `409 PLAN_ARCHIVED` (archived plans blocked), `409 CONFLICT` (optimistic concurrency), `403 FORBIDDEN`

### `plan-capability-profile-get`

- **Auth**: superadmin JWT
- **Input**: `{ planId }`
- **Output (200)**:

  ```json
  {
    "planId": "<uuid>",
    "planSlug": "professional",
    "planDisplayName": "Professional",
    "planStatus": "active",
    "capabilityProfile": [
      {
        "capabilityKey": "sql_admin_api",
        "displayLabel": "SQL Admin API",
        "description": "Enables direct SQL admin access to the tenant's PostgreSQL databases",
        "enabled": true,
        "source": "explicit",
        "platformDefault": false
      },
      {
        "capabilityKey": "passthrough_admin",
        "displayLabel": "Passthrough Admin Proxy",
        "description": "Enables the passthrough admin proxy for direct database management",
        "enabled": false,
        "source": "platform_default",
        "platformDefault": false
      }
    ],
    "orphanedCapabilities": []
  }
  ```

  `source` is `"explicit"` when the plan's `capabilities` JSONB contains the key, or `"platform_default"` when inherited.

  `orphanedCapabilities` lists capability keys present in the plan's JSONB but absent from the active catalog (FR-017):

  ```json
  {
    "orphanedCapabilities": [
      { "capabilityKey": "legacy_feature", "enabled": true, "status": "orphaned" }
    ]
  }
  ```

- **Errors**: `404 PLAN_NOT_FOUND`, `403 FORBIDDEN`

### `tenant-effective-capabilities-get`

- **Auth**: superadmin JWT (any tenant) or tenant owner JWT (own tenant only)
- **Input**: `{ tenantId }`
- **Output (200)**:

  ```json
  {
    "tenantId": "acme-corp",
    "planSlug": "professional",
    "capabilities": [
      {
        "displayLabel": "SQL Admin API",
        "enabled": true
      },
      {
        "displayLabel": "Passthrough Admin Proxy",
        "enabled": false
      }
    ]
  }
  ```

  Tenant-facing response: display labels and enabled/disabled only. No capability keys, no catalog metadata, no internal sources (FR-008).

- **No-plan case**: `{ "tenantId": "acme-corp", "noAssignment": true, "capabilities": [] }`
- **Errors**: `403 FORBIDDEN`, `404 TENANT_NOT_FOUND`

### `plan-capability-audit-query`

- **Auth**: superadmin JWT
- **Input**: `{ planId?, capabilityKey?, actorId?, fromDate?, toDate?, page?, pageSize? }`
  - All filters optional; defaults to all capability events, page 1, size 50
- **Output (200)**:

  ```json
  {
    "events": [
      {
        "eventId": "<uuid>",
        "planId": "<uuid>",
        "planSlug": "starter",
        "actionType": "plan.capability.enabled",
        "capabilityKey": "webhooks",
        "previousState": null,
        "newState": true,
        "actorId": "admin@platform.io",
        "timestamp": "<ISO8601>"
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 50
  }
  ```

- **Errors**: `403 FORBIDDEN`

---

## Phase 1: Integration with Existing Actions

### Modifications to Existing Code

#### `effective-entitlements-repository.mjs`

The current `toCapabilityList` function uses `capabilityKey` as both the key and `displayLabel`. With the catalog in place, this will be enhanced to join against `boolean_capability_catalog` to resolve proper display labels, descriptions, and platform defaults for capabilities not explicitly set on the plan. The effective resolution becomes:

```text
For each active catalog entry:
  if plan.capabilities[key] is explicitly set → use that value (source: "explicit")
  else → use catalog.platform_default (source: "platform_default")
```

This is a backward-compatible enhancement — the existing `plan-effective-entitlements-get.mjs` action's `capabilities` array gains richer metadata but the shape remains compatible.

#### `plan-create.mjs` and `plan-update.mjs`

Add catalog key validation: before persisting `capabilities`, verify all keys exist in `boolean_capability_catalog` with `is_active = true`. Reject unknown keys with `400 INVALID_CAPABILITY_KEY`. This is additive — the existing `validateBooleanMap` check in the `Plan` model remains; catalog validation is layered on top in the action/repository.

#### `plan-update.mjs` — Audit Event Emission

When capabilities are modified via `plan-update.mjs`, emit `plan.capability.enabled` / `plan.capability.disabled` audit events for each changed capability. Currently `plan-update.mjs` emits a generic `plan.updated` event — this is extended with per-capability granular events.

---

## Testing Strategy

### Unit Tests

- `boolean-capability.mjs` model: validation of capability key format (snake_case, 1–64 chars), display label required, description required, platform default is boolean
- Capability merge logic: explicit plan setting overrides platform default; absent key inherits default; orphaned key detection

### Integration Tests (node:test)

#### `capability-catalog.test.mjs`

- Query catalog returns all 7 seeded capabilities with correct metadata (FR-001, FR-002, SC-004)
- Each capability has unique key, display label, description, platform default (FR-001)
- `includeInactive=true` includes soft-deleted capabilities
- `includeInactive=false` (default) excludes soft-deleted capabilities
- Attempting to enable a key not in catalog is rejected with `INVALID_CAPABILITY_KEY` (FR-005, SC-005)

#### `plan-capability-crud.test.mjs`

- Enable `realtime` and `webhooks` on a plan: persisted correctly, both show as enabled in profile (US-1 scenario 1, FR-003)
- Query plan's capability profile: returns every recognized capability with enabled/disabled state and source (US-1 scenario 2, FR-006, SC-001)
- Attempt to enable `nonexistent_feature`: rejected with `INVALID_CAPABILITY_KEY` (US-1 scenario 3, FR-005, SC-005)
- Disable `webhooks` on a plan that has it enabled: persisted as disabled, audit event recorded (US-1 scenario 4, FR-003, FR-009)
- Enable already-enabled capability (no-op): no audit event, no data modification (FR-010)
- Capability on archived plan: rejected with `PLAN_ARCHIVED` (FR-011, SC-008)
- Capability on deprecated plan: accepted but audited (FR-011)
- Multiple capabilities in single request: all changed, individual audit events per capability
- Concurrent capability modifications: optimistic concurrency conflict returns `409`
- Structurally identical profiles for different plans enable tier comparison (SC-006)

#### `plan-capability-profile.test.mjs`

- Profile shows explicit capabilities with `source: "explicit"` (FR-006)
- Profile shows unset capabilities with `source: "platform_default"` and the catalog's default value (FR-004, FR-006)
- Profile for plan with orphaned capability key: orphan flagged as `"orphaned"` (FR-017)
- Profile response is structurally identical across plans (SC-006)

#### `tenant-effective-capabilities.test.mjs`

- Tenant on `professional` plan: sees capabilities matching plan's configuration (US-4 scenario 1, FR-007, SC-002)
- Tenant with no plan: returns `noAssignment: true`, empty capabilities (US-4 scenario 2, FR-007)
- Tenant response includes display labels only, no internal keys or catalog metadata (US-4 scenario 3, FR-008, SC-002)
- Tenant cannot see other tenants' capabilities (SC-007)

#### `capability-audit.test.mjs`

- Enabling a capability produces audit event with correct actor, timestamp, plan, key, previous/new state (US-5 scenario 1, FR-009, SC-003)
- Disabling a capability produces audit event with previous `enabled` and new `disabled` (US-5 scenario 2, FR-009)
- Querying audit history returns chronological results with all fields (US-5 scenario 3, FR-009)
- Kafka events emitted for capability enable and disable (FR-013)
- No-op change: no audit event (FR-010)

#### `capability-isolation.test.mjs`

- Tenant A's effective capabilities invisible to tenant B (FR-015, SC-007)
- Tenant owner can query own capabilities but not modify them (FR-014, FR-015)
- Tenant owner response excludes internal catalog metadata (FR-008)

### Contract Tests

- Validate OpenWhisk action response shapes against JSON schemas in `contracts/`
- Verify error codes for all rejection scenarios

### Observability Validation

- Kafka event emission verified in integration tests via `kafkajs` consumer with 5s timeout
- `plan_audit_events` rows verified via `pg` direct query assertions

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Capability key validation breaks existing plans with non-catalog keys | Medium | High | Migration does NOT modify existing plan data. Validation is enforced on new writes only. Orphaned keys are flagged in profile queries, not rejected. Existing `plan-create.mjs` and `plan-update.mjs` get catalog validation only for new/modified capability keys. |
| Race between concurrent capability modifications on the same plan | Medium | Medium | Optimistic concurrency via `updated_at` column on `plans` table (existing mechanism from 097) |
| Catalog seeded capabilities don't match actual platform features | Low | Low | Capabilities govern availability, not implementation. The catalog declares intent; actual enforcement is deferred to T05. Features not yet implemented simply have no enforcement effect. |
| `boolean_capability_catalog` confused with `capability_catalog_metadata` (090) | Low | Medium | Clear naming distinction: `boolean_capability_catalog` is for product-plan-level feature toggles; `capability_catalog_metadata` is for workspace-level infrastructure resource types. Documentation and comments clarify the distinction. |
| Kafka publish failure after DB commit for capability events | Low | Low | Fire-and-forget (platform pattern); `plan_audit_events` row is the durable audit record; Kafka failure does not roll back |
| New catalog entry added while many plans exist | Low | Low | New capabilities inherit `platform_default` for all plans (FR-016); no plan modifications needed |
| Orphaned capability accumulates in plan JSONB over time | Low | Low | Profile queries flag orphans; superadmins can clean up via `plan-capability-set` (set orphaned key to `false` or remove). Not automated — administrative decision. |

---

## Dependencies & Sequencing

### Prerequisites

- **US-PLAN-01-T01** (`097-plan-entity-tenant-assignment`): `plans` table with `capabilities JSONB` column, `plan_audit_events` table, `tenant_plan_assignments` table must be in place.
- **US-PLAN-01-T02** (`098-plan-base-limits`): `quota_dimension_catalog` pattern is the structural template for `boolean_capability_catalog`.
- **Migration ordering**: `104-plan-boolean-capabilities.sql` must run after `097-plan-entity-tenant-assignment.sql`.

### Parallelizable Work

- `boolean_capability_catalog` DDL + seed migration can be developed in parallel with model and repository
- Catalog list action can be developed in parallel with plan capability set action
- Contract JSON files and integration test fixtures can be prepared before actions are complete
- Tenant effective capabilities action can be developed in parallel with admin profile query (different auth paths)

### Recommended Implementation Sequence

1. Write and apply migration `104-plan-boolean-capabilities.sql` (new `boolean_capability_catalog` table with 7 seeded rows, indexes, trigger)
2. Implement `boolean-capability.mjs` model (catalog entry validation, capability key validation)
3. Implement `boolean-capability-catalog-repository.mjs` (catalog query, key existence check)
4. Implement `plan-capability-repository.mjs` (capability read/merge/persist with catalog validation, optimistic concurrency)
5. Implement `plan-capability-events.mjs` (Kafka event emission for capability enable/disable)
6. Implement `capability-catalog-list.mjs` action
7. Implement `plan-capability-set.mjs` action (enable/disable + lifecycle guard + audit + Kafka)
8. Implement `plan-capability-profile-get.mjs` action (full profile with source attribution + orphan detection)
9. Implement `tenant-effective-capabilities-get.mjs` action (tenant-facing, display labels only)
10. Implement `plan-capability-audit-query.mjs` action (filtered audit query)
11. Update `effective-entitlements-repository.mjs` to resolve display labels from catalog
12. Add catalog key validation to `plan-create.mjs` and `plan-update.mjs`
13. Write contract JSON files in `specs/104-plan-boolean-capabilities/contracts/`
14. Write integration tests; run against local PostgreSQL + Kafka fixtures
15. Update `AGENTS.md` with new env vars, Kafka topics, and table descriptions

### New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAPABILITY_KAFKA_TOPIC_ENABLED` | `console.plan.capability.enabled` | Kafka topic for capability enabled events |
| `CAPABILITY_KAFKA_TOPIC_DISABLED` | `console.plan.capability.disabled` | Kafka topic for capability disabled events |

---

## Criteria of Done

| ID | Criterion | Evidence |
|----|-----------|---------|
| DOD-01 | Migration `104-plan-boolean-capabilities.sql` applied cleanly to a fresh DB (after 097) | `psql` schema dump shows `boolean_capability_catalog` table with 7 seeded rows |
| DOD-02 | Catalog query returns all 7 recognized capabilities with key, label, description, and platform default (FR-001, FR-002) | `capability-catalog.test.mjs` assertions |
| DOD-03 | Superadmin can enable/disable capabilities on a plan; changes persisted in `plans.capabilities` JSONB (FR-003, SC-001) | `plan-capability-crud.test.mjs` assertions |
| DOD-04 | Capabilities not explicitly set on a plan inherit platform default from catalog (FR-004) | `plan-capability-profile.test.mjs` assertion |
| DOD-05 | Attempting to enable a key not in the catalog is rejected with `INVALID_CAPABILITY_KEY` (FR-005, SC-005) | `plan-capability-crud.test.mjs` + `capability-catalog.test.mjs` assertions |
| DOD-06 | Plan capability profile query returns every recognized capability with effective state and source (`explicit` or `platform_default`) (FR-006, SC-006) | `plan-capability-profile.test.mjs` assertions |
| DOD-07 | Tenant effective capabilities query returns display labels and enabled/disabled only; no internal metadata (FR-007, FR-008, SC-002) | `tenant-effective-capabilities.test.mjs` assertions |
| DOD-08 | Every capability change produces a `plan_audit_events` row with actor, timestamp, plan, key, previous/new state (FR-009, SC-003) | `capability-audit.test.mjs` assertions |
| DOD-09 | No-op changes do not produce audit events or data modifications (FR-010) | `plan-capability-crud.test.mjs` no-op assertion |
| DOD-10 | Capability modifications blocked on archived plans; permitted (with audit) on draft/active/deprecated (FR-011, SC-008) | `plan-capability-crud.test.mjs` lifecycle guard assertions |
| DOD-11 | Each plan has independent capability configuration (FR-012) | `plan-capability-crud.test.mjs` multi-plan assertions |
| DOD-12 | Kafka events emitted for every capability change (FR-013) | `capability-audit.test.mjs` Kafka consumer assertions |
| DOD-13 | Only superadmin can modify capabilities; tenant owner is read-only (FR-014, FR-015) | `capability-isolation.test.mjs` assertions |
| DOD-14 | Adding a new capability to the catalog does not require modifying existing plans (FR-016, SC-004) | `capability-catalog.test.mjs` new-capability assertion |
| DOD-15 | Orphaned capability keys flagged in profile queries; no enforcement effect (FR-017) | `plan-capability-profile.test.mjs` orphan assertion |
| DOD-16 | No cross-tenant data leakage in effective capabilities (SC-007) | `capability-isolation.test.mjs` assertions |
| DOD-17 | Contract JSON files present for all 5 action contracts | Files exist in `specs/104-plan-boolean-capabilities/contracts/` |
| DOD-18 | `data-model.md` present and accurate | File present in `specs/104-plan-boolean-capabilities/` |
| DOD-19 | `AGENTS.md` updated with new env vars, Kafka topics, and table descriptions | `AGENTS.md` diff includes new section |
| DOD-20 | Unrelated untracked artifacts preserved | `git status` confirms `specs/070-*/plan.md`, `specs/070-*/tasks.md`, `specs/072-*/tasks.md` untracked and unmodified |

---

## Complexity Tracking

No constitution violations. No complexity exceptions required. One new table (7 seed rows), zero new columns on existing tables, five new actions, two new Kafka topics — all within the established `provisioning-orchestrator` footprint. Existing `plans.capabilities` JSONB column is reused with added catalog validation.
