# Implementation Plan: Function Deployment Audit, Rollback Evidence, and Quota-Enforcement Verification

**Branch**: `006-function-audit-quota-verification` | **Date**: 2026-03-27 | **Spec**: `specs/006-function-audit-quota-verification/spec.md`
**Task**: US-FN-03-T06
**Input**: Feature specification from `/specs/006-function-audit-quota-verification/spec.md`

## Summary

Add the audit, evidence, and verification layer that makes the function lifecycle capabilities delivered by sibling tasks governable and demonstrable. The increment is bounded to: recording deployment and administrative action audit entries, capturing rollback evidence records with version and outcome detail, recording quota enforcement verification records for denials and near-threshold allowances, enforcing scope-bounded audit access, providing superadmin governance coverage visibility, and attributing console-backend-originated actions in audit records. No versioning, rollback mechanics, secret management, quota enforcement logic, console backend execution, or import/export behavior is introduced. This task must remain compatible with T01 (versioning/rollback), T02 (secrets), T03 (quota), T04 (console backend), and T05 (import/export) already delivered.

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON contract artifacts, Markdown planning assets
**Primary Dependencies**: Node built-in `node:test`, existing root validation scripts, `services/adapters/src/openwhisk-admin.mjs`, `services/internal-contracts/src/index.mjs`, `public-route-catalog.json`, `authorization-model.json`, `internal-service-map.json`, `domain-model.json`, Kafka (audit event backbone)
**Storage**: Kafka topics for audit events; PostgreSQL for queryable audit record persistence (filtered/bounded queries); no new OpenWhisk cluster changes
**Testing**: root validation scripts plus unit, adapter, contract, and resilience test suites under Node `node:test`
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners
**Performance Goals**: audit event emission is asynchronous and non-blocking relative to the governed action; audit query APIs are synchronous with mandatory pagination
**Constraints**: preserve tenant/workspace isolation from T01–T05; avoid absorbing sibling scope; stay compatible with `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE` and `console_backend_activation` propagation target from T04; keep changes root-validated
**Scale/Scope**: one new control-plane module, additive extensions to adapter and admin modules, four additive patches to internal contract JSON artifacts, new OpenAPI operations in the `functions` family, and matching test suites

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — new `functions-audit.mjs` module stays under `apps/control-plane/src/`; adapter extensions stay under `services/adapters/src/`; contract JSON patches stay under `services/internal-contracts/src/`; tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work adds audit emission helpers, query routes, and contract entries without modifying OpenWhisk cluster runtime or sibling task logic.
- **Kubernetes and OpenShift Compatibility**: PASS — Kafka and PostgreSQL are already cluster services; no new infra components are required.
- **Quality Gates at the Root**: PASS — validated through existing root `generate:public-api`, `validate:public-api`, `validate:openapi`, `test:unit`, `test:adapters`, and `test:contracts` commands.
- **Documentation as Part of the Change**: PASS — spec, plan, and task artifacts are included in the feature branch.
- **API Symmetry**: PASS — audit query routes follow the same tenant/workspace binding, required headers, error envelope, and audience restrictions as the existing functions family; no separate privileged surface is introduced.
- **T01–T05 Non-Regression**: PASS — no existing exports from `functions-admin.mjs`, `openwhisk-admin.mjs`, or any contract JSON are modified; all changes are purely additive.

## Project Structure

### Documentation (this feature)

```text
specs/006-function-audit-quota-verification/
├── spec.md
├── plan.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   └── families/
    │       └── functions.openapi.json          ← additive: four new audit query operations
    │                                              (listFunctionDeploymentAudit,
    │                                               listFunctionAdminAudit,
    │                                               listFunctionRollbackEvidence,
    │                                               listFunctionQuotaEnforcement);
    │                                              new schema components: DeploymentAuditEntry,
    │                                              AdminActionAuditEntry, RollbackEvidenceRecord,
    │                                              QuotaEnforcementRecord, AuditCoverageReport,
    │                                              AuditQueryParams, AuditPage
    └── src/
        ├── functions-audit.mjs                 ← new file: audit emission, evidence building,
        │                                          quota verification recording, query helpers,
        │                                          and scope-bounded access enforcement
        └── functions-admin.mjs                 ← additive: re-exports audit helpers,
                                                   extends summarizeFunctionsAdminSurface()
                                                   and getOpenWhiskCompatibilitySummary()

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                 ← additive: audit event builder constants,
│                                                  buildDeploymentAuditEvent(),
│                                                  buildAdminActionAuditEvent(),
│                                                  buildRollbackEvidenceEvent(),
│                                                  buildQuotaEnforcementEvent()
└── internal-contracts/
    └── src/
        ├── authorization-model.json            ← additive: audit_query_context propagation target;
        │                                          four new AUTHZ-FN-AUD-* denial scenarios
        ├── internal-service-map.json           ← additive: two new control_api responsibilities
        ├── public-route-catalog.json           ← additive: four new audit query route entries
        └── domain-model.json                  ← additive: five new entity definitions,
                                                   three new business invariants

tests/
├── unit/
│   └── functions-audit.test.mjs               ← new file
├── adapters/
│   └── openwhisk-admin.test.mjs               ← additive: assertions for audit event builders
├── contracts/
│   └── functions-audit.contract.test.mjs      ← new file
└── resilience/
    └── functions-audit-authorization.test.mjs ← new file
```

## Target Architecture and Flow

### Audit emission (write path)

1. A governed action (deployment, admin change, rollback, quota enforcement) completes inside the existing domain logic owned by T01–T04.
2. The `functions-audit.mjs` helper for that action type is called with the action outcome and the actor/scope context already available at the call site.
3. The helper builds a typed event using the corresponding `buildXxxAuditEvent()` adapter function, stamps `tenant_id`, `workspace_id`, `actor`, `correlation_id`, `timestamp`, and `action_type`, and publishes it to the `function.audit.events` Kafka topic.
4. A lightweight Kafka consumer (existing infrastructure) persists the event to the `function_audit_records` PostgreSQL table with indexes on `(tenant_id, workspace_id, action_type, created_at)`.
5. The write path is fire-and-forget relative to the HTTP response for the governed action; failures are logged and retried by the Kafka consumer, not by the action handler.

### Audit query (read path)

1. An authorized operator sends `GET /v1/functions/workspaces/{workspaceId}/audit` with optional query parameters `actionType`, `since`, `until`, `actor`, `functionId`, `limit`, and `cursor`.
2. APISIX resolves `tenant_id` and `workspace_id` and validates `workspace_owner`, `workspace_admin`, or `platform_team` role.
3. The `control_api` enforcement surface calls `functions-audit.mjs → queryAuditRecords(context, params)`, which asserts the caller's `tenant_id` and `workspace_id` match the route scope before executing the query.
4. Results are returned as a paginated `AuditPage` with a `nextCursor` for continuation; result sets are bounded by `limit` (max 200, default 50).
5. Rollback evidence and quota enforcement records are queryable on sub-routes (`/rollback-evidence`, `/quota-enforcement`) with the same scope binding and pagination contract.

### Superadmin coverage report

- A superadmin calls `GET /v1/admin/functions/audit/coverage` to receive an `AuditCoverageReport` confirming that expected event types are being recorded per active scope, without returning tenant-specific business data.
- The report enumerates active tenant/workspace scopes and the presence or absence of each governed event type within the requested time window.

### Console backend attribution

- When the action being audited originated from the console backend path (T04), the audit event includes `initiating_surface: 'console_backend'` from the existing `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE` constant and preserves the original `actor` and scope context.
- No new identity fields are required; the `console_backend_activation` propagation target from T04 already defines the required field set.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/openwhisk-admin.mjs`

- Export `OPENWHISK_AUDIT_ACTION_TYPES = Object.freeze({ DEPLOY: 'function.deployed', ADMIN: 'function.admin_action', ROLLBACK: 'function.rolled_back', QUOTA_ENFORCED: 'function.quota_enforced' })` — stable event type identifiers.
- Export `OPENWHISK_AUDIT_SCHEMA_VERSION = '1.0'` — anchors the event schema version in the adapter.
- Export `buildDeploymentAuditEvent(context, detail)` — returns a typed event for `function.deployed`; required fields: `actor`, `tenantId`, `workspaceId`, `correlationId`, `functionId`, `deploymentNature` (`create|update|redeploy`), `timestamp`.
- Export `buildAdminActionAuditEvent(context, detail)` — returns a typed event for `function.admin_action`; required fields as above plus `actionType` (`config_change|visibility_change|enable|disable|delete`), `targetFunctionId`.
- Export `buildRollbackEvidenceEvent(context, detail)` — returns a typed event for `function.rolled_back`; required fields as above plus `sourceVersion`, `targetVersion`, `outcome` (`success|failure`).
- Export `buildQuotaEnforcementEvent(context, detail)` — returns a typed event for `function.quota_enforced`; required fields as above plus `decision` (`allowed|denied`), `quotaDimension`, `remainingCapacity` (required when `decision = allowed` near threshold), `denialReason` (required when `decision = denied`).
- No changes to: existing tenant invocation paths, version/rollback helpers, secret resolution helpers, console backend annotation logic, or import/export helpers introduced by T01–T05.

### `apps/control-plane/src/functions-audit.mjs` (new file)

Follows the pattern of `console-backend-functions.mjs` and `functions-import-export.mjs`. Exports:

- `AUDIT_ACTION_TYPES` — re-export of `OPENWHISK_AUDIT_ACTION_TYPES` for control-plane consumers.
- `AUDIT_SCOPE_ERROR_CODES = Object.freeze({ SCOPE_VIOLATION: 'AUDIT_SCOPE_VIOLATION', COVERAGE_UNAUTHORIZED: 'AUDIT_COVERAGE_UNAUTHORIZED' })`.
- `emitDeploymentAuditEvent(context, detail)` — calls the adapter builder, publishes to Kafka, returns the event id.
- `emitAdminActionAuditEvent(context, detail)` — same pattern for admin action events.
- `emitRollbackEvidenceEvent(context, detail)` — same pattern for rollback events.
- `emitQuotaEnforcementEvent(context, detail)` — same pattern for quota enforcement events.
- `queryAuditRecords(context, params)` — validates caller scope, builds bounded SQL query, returns `AuditPage`.
- `queryRollbackEvidence(context, params)` — scope-validated query restricted to `action_type = 'function.rolled_back'`.
- `queryQuotaEnforcement(context, params)` — scope-validated query restricted to `action_type = 'function.quota_enforced'`.
- `buildAuditCoverageReport(adminContext, params)` — superadmin-only; queries event presence per active scope without returning business field values.
- `summarizeFunctionAuditSurface()` — introspectable surface summary for admin inventory consumers.

### `apps/control-plane/src/functions-admin.mjs`

- Import and re-export `AUDIT_ACTION_TYPES`, `AUDIT_SCOPE_ERROR_CODES`, `emitDeploymentAuditEvent`, `emitAdminActionAuditEvent`, `emitRollbackEvidenceEvent`, and `emitQuotaEnforcementEvent` from `functions-audit.mjs`.
- Extend `summarizeFunctionsAdminSurface()` to include three new resource kind entries: `function_deployment_audit` (actions: `['list']`), `function_rollback_evidence` (actions: `['list']`), `function_quota_enforcement_audit` (actions: `['list']`).
- Extend `getOpenWhiskCompatibilitySummary()` to add `functionAuditSupported: true`.
- No changes to: existing route listing functions, console backend identity exports, import/export exports, or T01–T05 exports.

### `apps/control-plane/openapi/families/functions.openapi.json`

Add four new operation objects:

- `GET /v1/functions/workspaces/{workspaceId}/audit` — `operationId: listFunctionDeploymentAudit`; query params: `actionType`, `since`, `until`, `actor`, `functionId`, `limit` (max 200), `cursor`; response: `AuditPage<DeploymentAuditEntry | AdminActionAuditEntry>`; audiences: `workspace_owner`, `workspace_admin`, `platform_team`; tenant/workspace binding required.
- `GET /v1/functions/workspaces/{workspaceId}/audit/rollback-evidence` — `operationId: listFunctionRollbackEvidence`; same query params; response: `AuditPage<RollbackEvidenceRecord>`; same audiences and bindings.
- `GET /v1/functions/workspaces/{workspaceId}/audit/quota-enforcement` — `operationId: listFunctionQuotaEnforcement`; same query params; response: `AuditPage<QuotaEnforcementRecord>`; same audiences and bindings.
- `GET /v1/admin/functions/audit/coverage` — `operationId: getFunctionAuditCoverage`; query params: `since`, `until`; response: `AuditCoverageReport`; audiences: `platform_team`, `superadmin`; no workspace binding; superadmin only.

Add seven new schema components:

- `DeploymentAuditEntry` — `id`, `actionType` (enum `function.deployed`), `actor`, `tenantId`, `workspaceId`, `functionId`, `deploymentNature`, `initiating_surface` (optional), `correlationId`, `timestamp`, `schemaVersion`.
- `AdminActionAuditEntry` — same base fields plus `targetActionType` (enum `config_change|visibility_change|enable|disable|delete`), `targetFunctionId`.
- `RollbackEvidenceRecord` — same base fields plus `sourceVersion`, `targetVersion`, `outcome` (enum `success|failure`).
- `QuotaEnforcementRecord` — same base fields plus `decision` (enum `allowed|denied`), `quotaDimension`, `remainingCapacity` (optional), `denialReason` (optional).
- `AuditCoverageReport` — `generatedAt`, `timeWindow` (`since`, `until`), `scopeCoverage` (array of `{ tenantId, workspaceId, eventTypesCaptured: string[], eventTypesMissing: string[] }`); no function-specific business fields.
- `AuditQueryParams` — shared query parameter schema for all audit list operations.
- `AuditPage` — `items` (typed array), `total` (optional), `nextCursor` (optional), `limit`.

No existing paths, operations, or schema components are modified.

### `services/internal-contracts/src/authorization-model.json`

- In `propagation_targets`, add `audit_query_context` listing required fields for audit query scope propagation: `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `query_scope` (required), `action_type_filter` (optional).
- In `negative_scenarios`, add four new denial entries:
  - `AUTHZ-FN-AUD-001`: Caller queries audit records outside their authorized tenant — denied without revealing foreign records.
  - `AUTHZ-FN-AUD-002`: Caller queries audit records outside their authorized workspace — denied without revealing foreign records.
  - `AUTHZ-FN-AUD-003`: Non-superadmin calls the coverage report endpoint — denied.
  - `AUTHZ-FN-AUD-004`: Audit query exceeds the maximum page size (`limit > 200`) — rejected before execution.
- No changes to: existing role catalog, `console_backend_activation`, `definition_import_context`, or any T01–T05 entries.

### `services/internal-contracts/src/internal-service-map.json`

- In the `control_api` responsibilities array, add two new entries:
  - `"Accept authorized audit query requests scoped to the caller's tenant and workspace, apply mandatory pagination, and return audit records without crossing scope boundaries."`
  - `"Emit structured audit events to the function.audit.events Kafka topic for each governed deployment, administrative, rollback, and quota enforcement action."`
- No other service definitions or ownership boundaries are changed.

### `services/internal-contracts/src/public-route-catalog.json`

Add four new route entries following the shape of existing `functions` routes:

- `listFunctionDeploymentAudit`: `GET /v1/functions/workspaces/{workspaceId}/audit`, `resourceType: 'function_audit'`, `family: 'functions'`, `rateLimitClass: 'read'`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`.
- `listFunctionRollbackEvidence`: `GET /v1/functions/workspaces/{workspaceId}/audit/rollback-evidence`, same profile.
- `listFunctionQuotaEnforcement`: `GET /v1/functions/workspaces/{workspaceId}/audit/quota-enforcement`, same profile.
- `getFunctionAuditCoverage`: `GET /v1/admin/functions/audit/coverage`, `resourceType: 'function_audit_coverage'`, `family: 'functions'`, `rateLimitClass: 'read'`, `tenantBinding: 'none'`, `workspaceBinding: 'none'`, `audiences: ['platform_team', 'superadmin']`.

No existing route entries are modified.

### `services/internal-contracts/src/domain-model.json`

- Add five new entity definitions under `entities`: `DeploymentAuditEntry`, `AdminActionAuditEntry`, `RollbackEvidenceRecord`, `QuotaEnforcementRecord`, `AuditCoverageReport`.
- Add three new business invariants:
  - `BI-FN-AUD-001`: An audit entry must be emitted for every governed action before the action's HTTP response is returned; emission failure must not silently suppress the record — the event must be retried via Kafka consumer.
  - `BI-FN-AUD-002`: An audit query must never return records belonging to a tenant or workspace other than the caller's authorized scope, regardless of filter parameters.
  - `BI-FN-AUD-003`: A rollback evidence record must be emitted for every rollback attempt regardless of outcome; a failed rollback must produce a record with `outcome: 'failure'`, not an absent record.
- No existing entities, relationships, or invariants are modified.

### `tests/unit/functions-audit.test.mjs` (new file)

Follows the pattern of `tests/unit/functions-admin.test.mjs`. Node `node:test`, no external dependencies. Covers:

- `AUDIT_ACTION_TYPES` exports all four required type identifiers.
- `AUDIT_SCOPE_ERROR_CODES` exports both error codes.
- `emitDeploymentAuditEvent` throws when `actor`, `tenantId`, or `workspaceId` are absent.
- `emitRollbackEvidenceEvent` throws when `outcome` is absent or not in `['success', 'failure']`.
- `emitQuotaEnforcementEvent` throws when `decision` is absent; includes `remainingCapacity` for `decision = 'allowed'`; includes `denialReason` for `decision = 'denied'`.
- `queryAuditRecords` throws `AUDIT_SCOPE_VIOLATION` when caller `tenantId` does not match route scope.
- `queryAuditRecords` throws `AUDIT_SCOPE_VIOLATION` when caller `workspaceId` does not match route scope.
- `buildAuditCoverageReport` returns an object with `scopeCoverage` array containing no function-specific business fields.
- `summarizeFunctionAuditSurface` returns a non-empty object.
- Console-backend-originated event includes `initiating_surface: 'console_backend'` when context carries the T04 surface identifier.

### `tests/adapters/openwhisk-admin.test.mjs` (additive)

Add assertions for:

- `OPENWHISK_AUDIT_ACTION_TYPES` exports all four type identifiers.
- `OPENWHISK_AUDIT_SCHEMA_VERSION` is a non-empty string.
- `buildDeploymentAuditEvent` returns an event with all required base fields.
- `buildRollbackEvidenceEvent` includes `sourceVersion`, `targetVersion`, and `outcome`.
- `buildQuotaEnforcementEvent` includes `quotaDimension` and `decision`.
- `buildAdminActionAuditEvent` includes `targetActionType` and `targetFunctionId`.

### `tests/contracts/functions-audit.contract.test.mjs` (new file)

Follows the pattern of `tests/contracts/functions-import-export.contract.test.mjs`. Covers:

- `DeploymentAuditEntry` schema satisfies `function_admin_result` contract baseline fields.
- `RollbackEvidenceRecord` includes `sourceVersion`, `targetVersion`, `outcome`.
- `QuotaEnforcementRecord` includes `decision`, `quotaDimension`.
- `AuditCoverageReport` does not contain function-specific business data fields.
- Audit query rejection for scope violation produces an `ErrorResponse`-compatible shape with a `GW_`-prefixed code.
- All four new route entries exist in `public-route-catalog.json` with the correct `tenantBinding` and `workspaceBinding` values.
- `audit_query_context` propagation target exists in `authorization-model.json` with `query_scope` marked required.
- `summarizeFunctionsAdminSurface()` includes `function_deployment_audit`, `function_rollback_evidence`, and `function_quota_enforcement_audit` resource kinds.
- `getOpenWhiskCompatibilitySummary()` returns `functionAuditSupported: true`.
- Superadmin coverage route has `tenantBinding: 'none'` and `workspaceBinding: 'none'` in the catalog.

### `tests/resilience/functions-audit-authorization.test.mjs` (new file)

Negative scenario tests for all four `AUTHZ-FN-AUD-*` denial scenarios:

- `AUTHZ-FN-AUD-001`: Query against a different tenant's workspace audit — denied, response does not reveal foreign records.
- `AUTHZ-FN-AUD-002`: Query against a workspace in the same tenant but outside the caller's authorized workspace — denied.
- `AUTHZ-FN-AUD-003`: Non-superadmin calls `getFunctionAuditCoverage` — HTTP 403, `GW_`-prefixed error code.
- `AUTHZ-FN-AUD-004`: Audit query with `limit = 201` — rejected before execution.
- Rollback evidence query for a failed rollback returns a record with `outcome: 'failure'` rather than an absent entry (invariant `BI-FN-AUD-003`).
- Quota enforcement denial record does not expose tenant data from other workspaces when queried by a different authorized operator in the same tenant.

## Data Model and Metadata Impact

**New PostgreSQL table** `function_audit_records` — consumed by the Kafka listener; not accessed directly by the control plane outside of query helpers:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `action_type` | `varchar(64)` | indexed |
| `tenant_id` | `uuid` | indexed, NOT NULL |
| `workspace_id` | `uuid` | indexed, NOT NULL |
| `function_id` | `uuid` | nullable |
| `actor` | `varchar(256)` | NOT NULL |
| `correlation_id` | `varchar(128)` | indexed |
| `initiating_surface` | `varchar(64)` | nullable; `'console_backend'` when T04 path |
| `detail` | `jsonb` | event-type-specific fields |
| `created_at` | `timestamptz` | indexed, NOT NULL |
| `schema_version` | `varchar(16)` | NOT NULL |

Compound index on `(tenant_id, workspace_id, action_type, created_at)` supports all filter combinations. No cross-tenant index or view is created. Tenant isolation is enforced in the query helper (`WHERE tenant_id = $1 AND workspace_id = $2`), not in the table definition alone.

**Kafka topic**: `function.audit.events` — partitioned by `tenant_id`; retention matches platform audit policy (not set by this increment). Event schema version is `OPENWHISK_AUDIT_SCHEMA_VERSION = '1.0'`.

**Contract artifacts**: `authorization-model.json` receives `audit_query_context` propagation target and four `AUTHZ-FN-AUD-*` denial scenarios. `domain-model.json` receives five entities and three invariants. `public-route-catalog.json` receives four routes. `internal-service-map.json` receives two `control_api` responsibility entries. All changes are additive.

## API and UX Considerations

- **New audit routes follow existing functions family shape exactly**: `gatewayAuthMode: 'bearer_oidc'`, `gatewayRouteClass: 'functions'`, `internalRequestMode: 'validated_attestation'`, `errorEnvelope: 'ErrorResponse'`, `supportsIdempotencyKey: false` (read operations).
- **Pagination is mandatory**: `limit` defaults to 50, max 200; requests without `limit` receive the default; `cursor`-based pagination prevents unbounded result sets.
- **Rollback evidence and quota enforcement are sub-routes**: they share the workspace binding pattern and pagination contract; they are not separate API families.
- **Coverage report reveals no business data**: `AuditCoverageReport.scopeCoverage` items contain only `tenantId`, `workspaceId`, and event type presence/absence. No function names, actor identities, or detail fields appear.
- **No new UI work**: audit query APIs are backend contract additions; no web-console UI components are introduced in this increment.
- **Error taxonomy**: all rejection responses use `GW_`-prefixed codes consistent with the gateway error taxonomy established for the functions family.
- **No sibling scope creep**: this increment does not rework versioning, rollback mechanics, secrets, quota enforcement logic, console backend execution, or import/export behavior.

## Testing Strategy

### Unit

`tests/unit/functions-audit.test.mjs` — all module exports, valid and invalid inputs, scope violation detection, console backend surface attribution, coverage report field exclusion.

### Adapter

`tests/adapters/openwhisk-admin.test.mjs` (additive) — all four event builders, constants, required field coverage for each event type.

### Contract

`tests/contracts/functions-audit.contract.test.mjs` — schema compliance, route catalog consistency, propagation target presence, compatibility summary extensions, coverage report data minimization.

### Resilience

`tests/resilience/functions-audit-authorization.test.mjs` — all four `AUTHZ-FN-AUD-*` denial scenarios, failed-rollback record presence, cross-workspace query isolation.

### E2E

No new runtime E2E environment required. `tests/e2e/` receives a describe-only scaffold for: (a) happy-path deployment audit entry queryable after a function is deployed; (b) rollback evidence record queryable and containing `outcome: 'failure'` after a failed rollback; (c) quota enforcement denial record queryable after a guardrail blocks an action; (d) cross-tenant audit query denied with HTTP 403.

### Operational validation

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Risks and Mitigations

- **Risk**: Audit emission adds latency to governed action HTTP responses if done synchronously.
  **Mitigation**: Emission is fire-and-forget via Kafka; the action handler publishes the event and returns the HTTP response without waiting for Kafka ack. Kafka consumer handles persistence and retry asynchronously.

- **Risk**: A rollback failure (T01) produces no audit record because the error path does not call the audit helper.
  **Mitigation**: `emitRollbackEvidenceEvent` is called in the rollback error handler, not only in the success path; invariant `BI-FN-AUD-003` and the resilience test for failed-rollback record presence both enforce this.

- **Risk**: Quota enforcement events from T03 contain dimension values that reveal cross-tenant quota state.
  **Mitigation**: `buildQuotaEnforcementEvent` takes only the dimension identifier and the `decision`/`remainingCapacity` values for the requesting scope; it does not include global quota counters or other tenant values; the contract test asserts no cross-tenant fields appear in the record.

- **Risk**: Coverage report endpoint leaks tenant-specific function names or actor identities to superadmins.
  **Mitigation**: `buildAuditCoverageReport` queries only event type presence/absence per scope; `detail` and actor fields are excluded from the response; the contract test asserts the `AuditCoverageReport` schema contains no business data fields.

- **Risk**: Pagination `cursor` is predictable or forgeable, allowing cross-scope record traversal.
  **Mitigation**: Cursors are opaque, server-generated tokens tied to the query's `tenant_id` and `workspace_id`; a cursor presented against a different workspace scope is rejected with `AUDIT_SCOPE_VIOLATION`; the resilience test covers cursor-scope binding.

- **Risk**: `summarizeFunctionsAdminSurface()` route count assertions in existing tests break because four new routes are added to `public-route-catalog.json`.
  **Mitigation**: Implementation step for `public-route-catalog.json` immediately runs `npm run test:unit` and `npm run test:contracts` to verify no existing count assertion breaks; any exact-count assertion is updated additively as part of this task's change plan.

- **Risk**: T06 implementation absorbs sibling scope by including quota enforcement logic or rollback mechanics.
  **Mitigation**: The constitution check and scope boundary in the spec are explicit; audit helpers receive pre-computed outcomes from T01/T03 call sites and do not re-implement enforcement or rollback; any change outside the artifact list requires explicit scope review.

## Recommended Implementation Sequence

1. Patch `services/internal-contracts/src/domain-model.json` with five new entities and three business invariants. Run `npm run test:contracts` to confirm domain model tests pass.
2. Patch `services/internal-contracts/src/authorization-model.json` with `audit_query_context` propagation target and four `AUTHZ-FN-AUD-*` denial scenarios. Run authorization model contract test to confirm backward compatibility.
3. Patch `services/internal-contracts/src/internal-service-map.json` with two new `control_api` responsibility entries. Run `tests/contracts/internal-service-map.contract.test.mjs`.
4. Add four new route entries to `services/internal-contracts/src/public-route-catalog.json`. Run `npm run test:unit` and `npm run test:contracts` immediately; patch any exact-count assertion additively.
5. Add four new operations and seven new schema components to `apps/control-plane/openapi/families/functions.openapi.json`. Run `npm run generate:public-api` and `npm run validate:openapi`.
6. Extend `services/adapters/src/openwhisk-admin.mjs` with audit constants and four event builders. Add additive assertions to `tests/adapters/openwhisk-admin.test.mjs`; all existing adapter tests must continue to pass.
7. Create `apps/control-plane/src/functions-audit.mjs` with all exports listed above. Write `tests/unit/functions-audit.test.mjs`. Run `npm run test:unit`.
8. Extend `apps/control-plane/src/functions-admin.mjs` with re-exports and compatibility summary extensions. Confirm existing `tests/unit/functions-admin.test.mjs` continues to pass without modification.
9. Write `tests/contracts/functions-audit.contract.test.mjs`. Run `npm run test:contracts`.
10. Write `tests/resilience/functions-audit-authorization.test.mjs`. Run full test suite and fix any gaps.
11. Apply the PostgreSQL migration (`function_audit_records` table and indexes) inside the existing Helm migration job.
12. Add E2E scaffold stubs in `tests/e2e/`.
13. Run all root validation commands; capture passing output before opening the PR.

## Parallelization Notes

- Steps 1, 2, and 3 (contract JSON patches) can proceed simultaneously once entity names and propagation target shapes are agreed.
- Step 4 (route catalog) depends on entity names from Step 1 but not on Steps 2 or 3.
- Step 5 (OpenAPI) can begin as soon as Step 4 is merged and CI is green; it does not block Steps 6 or 7.
- Step 6 (adapter extension) can begin in parallel with Step 5 once the event type constant names are stable.
- Step 7 (new control-plane module) depends on Step 6 adapter exports being stable but can begin in parallel with Step 5.
- Step 8 (`functions-admin.mjs` extension) depends on Step 7.
- Steps 9 and 10 (contract and resilience tests) can proceed in parallel once Steps 6, 7, and 8 are merged.
- Step 11 (DB migration) can proceed at any time after the entity schema is agreed; it does not block code steps.
- Step 13 (root validation gate) must be last before the PR is opened.

## Done Criteria

- Every function deployment produces a queryable `DeploymentAuditEntry` within the correct tenant and workspace scope (SC-001).
- Every administrative action on a function produces a queryable `AdminActionAuditEntry` with the correct action type and attribution (SC-002).
- Every rollback event — successful or failed — produces a `RollbackEvidenceRecord` that an auditor can retrieve independently (SC-003).
- Every quota enforcement decision (denial or near-threshold allowance) produces a queryable `QuotaEnforcementRecord` (SC-004).
- Audit queries from one tenant or workspace do not return records belonging to another tenant or workspace (SC-005).
- A superadmin can confirm audit coverage completeness without accessing tenant-specific function data (SC-006).
- All new unit, adapter, contract, and resilience tests pass.
- No existing tests regress across `npm run test:unit`, `npm run test:adapters`, and `npm run test:contracts`.
- All four `AUTHZ-FN-AUD-*` denial scenarios are present in `authorization-model.json` and covered by passing resilience tests.
- `getOpenWhiskCompatibilitySummary()` returns `functionAuditSupported: true`.
- `summarizeFunctionsAdminSurface()` includes `function_deployment_audit`, `function_rollback_evidence`, and `function_quota_enforcement_audit` resource kinds.
- Scope remains bounded to US-FN-03-T06; no sibling scope (T01–T05) is absorbed.

## Expected Evidence

- New file `apps/control-plane/src/functions-audit.mjs` present and importable.
- Additive diff to `services/adapters/src/openwhisk-admin.mjs` showing only the four audit constants and four event builder functions.
- Additive diff to `apps/control-plane/src/functions-admin.mjs` showing the re-exports and two compatibility summary extensions.
- Additive diff to `apps/control-plane/openapi/families/functions.openapi.json` showing four new operation objects and seven new schema components with no existing paths or schemas removed.
- Additive diffs to `services/internal-contracts/src/authorization-model.json` showing `audit_query_context` propagation target and four `AUTHZ-FN-AUD-*` denial scenarios.
- Additive diff to `services/internal-contracts/src/internal-service-map.json` showing two new `control_api` responsibility entries.
- Additive diff to `services/internal-contracts/src/public-route-catalog.json` showing four new route entries.
- Additive diff to `services/internal-contracts/src/domain-model.json` showing five new entity definitions and three new business invariants.
- New test files: `tests/unit/functions-audit.test.mjs`, `tests/contracts/functions-audit.contract.test.mjs`, `tests/resilience/functions-audit-authorization.test.mjs`.
- PostgreSQL migration script for `function_audit_records` table present in the Helm migration job.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` captured before the PR is opened.
- A representative `DeploymentAuditEntry` from a console-backend-originated deployment carries `initiating_surface: 'console_backend'` alongside the original actor and scope fields.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Dedicated `functions-audit.mjs` module | Audit emission, query, and coverage concerns are orthogonal to function administration and import/export; a dedicated module follows the `console-backend-functions.mjs` and `functions-import-export.mjs` precedents and keeps each surface auditable in isolation | Merging into `functions-admin.mjs` would obscure which exports are audit-specific and would increase sibling-scope drift risk across T01–T05 |
| Kafka + PostgreSQL dual write | Fire-and-forget Kafka emission preserves governed action latency; PostgreSQL persistence enables bounded, indexed, cursor-paginated queries with tenant isolation at the query layer | Writing directly to PostgreSQL from the action handler creates synchronous latency and tight coupling; writing only to Kafka without persistence would require a Kafka consumer API for every query, adding infrastructure complexity |
| Four `AUTHZ-FN-AUD-*` denial scenarios in the authorization model | Each scenario corresponds directly to a functional requirement and must be machine-readable for the resilience test harness to assert them with stable IDs | Omitting them leaves the negative scenario tests without a stable contract anchor and breaks requirement traceability between spec, plan, and test |
| Superadmin coverage route with no workspace binding | Coverage verification is a cross-scope governance operation that cannot be scoped to a single workspace without losing its value; it is explicitly distinguished from tenant-scoped audit queries by its route path and audience restriction | Adding workspace binding to the coverage route would prevent it from fulfilling the superadmin governance scenario; a separate route path and audience gate is the correct boundary |
