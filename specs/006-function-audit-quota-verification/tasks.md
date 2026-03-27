# Tasks: Function Deployment Audit, Rollback Evidence, and Quota-Enforcement Verification

**Input**: Design documents from `specs/006-function-audit-quota-verification/`  
**Prerequisites**: `plan.md`, `spec.md`  
**Branch**: `006-function-audit-quota-verification`  
**Story**: `US-FN-03-T06`

**Tests**: Unit, adapter, contract, and resilience coverage are required for this feature because tenant/workspace isolation, rollback evidence completeness (including failed rollbacks), and quota enforcement scope integrity must remain verifiable through the repo's quality gates.

**Organization**: Tasks are grouped by phase so the audit increment remains independently testable and can be validated before PR handoff. No versioning mechanics, rollback logic, secret management, quota enforcement logic, console backend execution, or import/export behavior from sibling tasks T01–T05 is absorbed.

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- Include exact file paths in every task

---

## Phase 1: Setup (Spec Artifact Finalization)

**Purpose**: Confirm the spec package is complete and the branch is ready for implementation.

- [x] T001 Confirm `specs/006-function-audit-quota-verification/spec.md` is finalized and on the feature branch
- [x] T002 Confirm `specs/006-function-audit-quota-verification/plan.md` is finalized and on the feature branch
- [x] T003 Create the execution task list in `specs/006-function-audit-quota-verification/tasks.md`

---

## Phase 2: Foundational (Contract JSON Patches)

**Purpose**: Establish the domain entities, authorization denial scenarios, service-map ownership, and route catalog entries that all audit code depends on. Nothing downstream proceeds until denial scenario IDs, entity names, and route shapes are stable.

**⚠️ CRITICAL**: No audit scenario is complete until the authorization-model and route-catalog validations pass with the new contract entries.

- [x] T004 Patch `services/internal-contracts/src/domain-model.json` with five new entity definitions and three new business invariants:
  - entities: `DeploymentAuditEntry`, `AdminActionAuditEntry`, `RollbackEvidenceRecord`, `QuotaEnforcementRecord`, `AuditCoverageReport`
  - invariant `BI-FN-AUD-001`: An audit entry must be emitted for every governed action before the action's HTTP response is returned; emission failure must not silently suppress the record — the event must be retried via the Kafka consumer.
  - invariant `BI-FN-AUD-002`: An audit query must never return records belonging to a tenant or workspace other than the caller's authorized scope, regardless of filter parameters.
  - invariant `BI-FN-AUD-003`: A rollback evidence record must be emitted for every rollback attempt regardless of outcome; a failed rollback must produce a record with `outcome: 'failure'`, not an absent record.
  - do not modify existing entities, relationships, or invariants
  - run `npm run test:contracts` immediately after patching to confirm no existing domain contract assertion breaks

- [x] T005 [P] Patch `services/internal-contracts/src/authorization-model.json`:
  - in `propagation_targets`, add `audit_query_context` with required fields `actor`, `tenant_id`, `workspace_id`, `correlation_id`, `query_scope` (required), and optional `action_type_filter`
  - add denial scenario `AUTHZ-FN-AUD-001`: Caller queries audit records outside their authorized tenant — denied without revealing foreign records.
  - add denial scenario `AUTHZ-FN-AUD-002`: Caller queries audit records outside their authorized workspace — denied without revealing foreign records.
  - add denial scenario `AUTHZ-FN-AUD-003`: Non-superadmin calls the coverage report endpoint — denied with HTTP 403.
  - add denial scenario `AUTHZ-FN-AUD-004`: Audit query with `limit > 200` — rejected before execution.
  - do not alter existing role catalogs, permission matrices, `console_backend_activation`, `definition_import_context`, or any T01–T05 entries

- [x] T006 [P] Patch `services/internal-contracts/src/internal-service-map.json` so `control_api` explicitly owns two new responsibilities:
  - `"Accept authorized audit query requests scoped to the caller's tenant and workspace, apply mandatory pagination, and return audit records without crossing scope boundaries."`
  - `"Emit structured audit events to the function.audit.events Kafka topic for each governed deployment, administrative, rollback, and quota enforcement action."`
  - do not modify any other service definitions or ownership boundaries

- [x] T007 [P] Add four new route entries to `services/internal-contracts/src/public-route-catalog.json`:
  - `listFunctionDeploymentAudit`: `GET /v1/functions/workspaces/{workspaceId}/audit`, `resourceType: 'function_audit'`, `family: 'functions'`, `rateLimitClass: 'read'`, `tenantBinding: 'required'`, `workspaceBinding: 'required'`
  - `listFunctionRollbackEvidence`: `GET /v1/functions/workspaces/{workspaceId}/audit/rollback-evidence`, same profile as above
  - `listFunctionQuotaEnforcement`: `GET /v1/functions/workspaces/{workspaceId}/audit/quota-enforcement`, same profile as above
  - `getFunctionAuditCoverage`: `GET /v1/admin/functions/audit/coverage`, `resourceType: 'function_audit_coverage'`, `family: 'functions'`, `rateLimitClass: 'read'`, `tenantBinding: 'none'`, `workspaceBinding: 'none'`, `audiences: ['platform_team', 'superadmin']`
  - match the existing functions route shape exactly; do not modify any existing entries
  - immediately run `npm run test:unit` and `npm run test:contracts` to confirm no existing route-count assertion breaks; patch any exact-count assertion additively if needed

- [x] T008 [P] Extend `tests/contracts/authorization-model.contract.test.mjs` and `tests/contracts/internal-service-map.contract.test.mjs` additively so that:
  - the `audit_query_context` propagation target with `query_scope` marked required is validated by the contract suite
  - all four `AUTHZ-FN-AUD-*` denial scenario IDs are validated by the contract suite
  - the two new `control_api` responsibility entries are validated by the contract suite

**Checkpoint**: Entity names, denial scenario IDs, propagation target shape, and route catalog entries are stable enough for OpenAPI and adapter work.

---

## Phase 3: OpenAPI Surface

**Purpose**: Add the four new audit query operations and seven new schema components to the functions OpenAPI family and regenerate the public contract artifacts.

- [x] T009 Add four new operation objects and seven new schema components to `apps/control-plane/openapi/families/functions.openapi.json`:
  - operations:
    - `listFunctionDeploymentAudit`: `GET /v1/functions/workspaces/{workspaceId}/audit`; query params `actionType`, `since`, `until`, `actor`, `functionId`, `limit` (max 200, default 50), `cursor`; response `AuditPage<DeploymentAuditEntry | AdminActionAuditEntry>`; audiences `workspace_owner`, `workspace_admin`, `platform_team`; `tenantBinding: 'required'`, `workspaceBinding: 'required'`
    - `listFunctionRollbackEvidence`: `GET /v1/functions/workspaces/{workspaceId}/audit/rollback-evidence`; same query params and audiences; response `AuditPage<RollbackEvidenceRecord>`
    - `listFunctionQuotaEnforcement`: `GET /v1/functions/workspaces/{workspaceId}/audit/quota-enforcement`; same query params and audiences; response `AuditPage<QuotaEnforcementRecord>`
    - `getFunctionAuditCoverage`: `GET /v1/admin/functions/audit/coverage`; query params `since`, `until`; response `AuditCoverageReport`; audiences `platform_team`, `superadmin`; no workspace binding; `supportsIdempotencyKey: false`
  - schemas:
    - `DeploymentAuditEntry`: `id`, `actionType` (enum `function.deployed`), `actor`, `tenantId`, `workspaceId`, `functionId`, `deploymentNature` (enum `create|update|redeploy`), `initiating_surface` (optional), `correlationId`, `timestamp`, `schemaVersion`
    - `AdminActionAuditEntry`: same base fields plus `targetActionType` (enum `config_change|visibility_change|enable|disable|delete`), `targetFunctionId`
    - `RollbackEvidenceRecord`: same base fields plus `sourceVersion`, `targetVersion`, `outcome` (enum `success|failure`)
    - `QuotaEnforcementRecord`: same base fields plus `decision` (enum `allowed|denied`), `quotaDimension`, `remainingCapacity` (optional, required when `decision = 'allowed'` near threshold), `denialReason` (optional, required when `decision = 'denied'`)
    - `AuditCoverageReport`: `generatedAt`, `timeWindow` (`since`, `until`), `scopeCoverage` (array of `{ tenantId, workspaceId, eventTypesCaptured: string[], eventTypesMissing: string[] }`); no function-specific business fields
    - `AuditQueryParams`: shared query parameter schema reused by the three workspace-scoped list operations
    - `AuditPage`: `items` (typed array), `total` (optional), `nextCursor` (optional), `limit`
  - all three workspace-scoped operations carry `gatewayAuthMode: 'bearer_oidc'`, `gatewayRouteClass: 'functions'`, `internalRequestMode: 'validated_attestation'`, `errorEnvelope: 'ErrorResponse'`, `supportsIdempotencyKey: false`
  - do not modify any existing paths, operations, or schema components

- [x] T010 Run `npm run generate:public-api` and `npm run validate:openapi` from the repo root; fix any schema or path drift before proceeding.

**Checkpoint**: OpenAPI family is valid and generated public artifacts are in sync.

---

## Phase 4: Adapter Extension

**Purpose**: Add audit event type constants, schema version constant, and four event builder functions to the OpenWhisk adapter layer.

- [x] T011 Extend `services/adapters/src/openwhisk-admin.mjs` with additive exports only:
  - `OPENWHISK_AUDIT_ACTION_TYPES = Object.freeze({ DEPLOY: 'function.deployed', ADMIN: 'function.admin_action', ROLLBACK: 'function.rolled_back', QUOTA_ENFORCED: 'function.quota_enforced' })`
  - `OPENWHISK_AUDIT_SCHEMA_VERSION = '1.0'`
  - `buildDeploymentAuditEvent(context, detail)`: returns a typed event for `function.deployed`; required fields `actor`, `tenantId`, `workspaceId`, `correlationId`, `functionId`, `deploymentNature` (`create|update|redeploy`), `timestamp`; includes `initiating_surface: 'console_backend'` when context carries the T04 surface identifier
  - `buildAdminActionAuditEvent(context, detail)`: returns a typed event for `function.admin_action`; required fields as above plus `targetActionType` (`config_change|visibility_change|enable|disable|delete`), `targetFunctionId`
  - `buildRollbackEvidenceEvent(context, detail)`: returns a typed event for `function.rolled_back`; required fields as above plus `sourceVersion`, `targetVersion`, `outcome` (`success|failure`)
  - `buildQuotaEnforcementEvent(context, detail)`: returns a typed event for `function.quota_enforced`; required fields as above plus `decision` (`allowed|denied`), `quotaDimension`, `remainingCapacity` (required when `decision = 'allowed'` near threshold), `denialReason` (required when `decision = 'denied'`)
  - preserve all existing tenant invocation paths, version/rollback helpers, secret resolution helpers, console backend annotation logic, and import/export helpers introduced by T01–T05

- [x] T012 [P] Add additive assertions to `tests/adapters/openwhisk-admin.test.mjs`:
  - `OPENWHISK_AUDIT_ACTION_TYPES` exports all four type identifiers
  - `OPENWHISK_AUDIT_SCHEMA_VERSION` is a non-empty string
  - `buildDeploymentAuditEvent` returns an event with all required base fields present
  - `buildDeploymentAuditEvent` includes `initiating_surface: 'console_backend'` when the context carries the `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE` identifier
  - `buildAdminActionAuditEvent` includes `targetActionType` and `targetFunctionId`
  - `buildRollbackEvidenceEvent` includes `sourceVersion`, `targetVersion`, and `outcome`
  - `buildRollbackEvidenceEvent` accepts `outcome: 'failure'` without throwing (evidence for failed rollbacks must be recorded)
  - `buildQuotaEnforcementEvent` includes `quotaDimension` and `decision`
  - `buildQuotaEnforcementEvent` throws when `decision = 'denied'` and `denialReason` is absent
  - `buildQuotaEnforcementEvent` throws when `decision = 'allowed'` near threshold and `remainingCapacity` is absent
  - no regression in existing adapter tests

**Checkpoint**: Adapter exports are stable and test-covered; control-plane module can be written against them.

---

## Phase 5: Control-Plane Module and Unit Coverage

**Purpose**: Create the dedicated audit control-plane module, extend the functions admin surface, and deliver full unit test coverage.

- [x] T013 Create `apps/control-plane/src/functions-audit.mjs` following the pattern of `apps/control-plane/src/functions-import-export.mjs`:
  - `AUDIT_ACTION_TYPES` — re-export of `OPENWHISK_AUDIT_ACTION_TYPES` from the adapter
  - `AUDIT_SCOPE_ERROR_CODES = Object.freeze({ SCOPE_VIOLATION: 'AUDIT_SCOPE_VIOLATION', COVERAGE_UNAUTHORIZED: 'AUDIT_COVERAGE_UNAUTHORIZED' })`
  - `emitDeploymentAuditEvent(context, detail)` — calls `buildDeploymentAuditEvent`, publishes to Kafka `function.audit.events` topic, returns the event id; throws when `actor`, `tenantId`, or `workspaceId` are absent
  - `emitAdminActionAuditEvent(context, detail)` — same Kafka publish pattern for `function.admin_action` events
  - `emitRollbackEvidenceEvent(context, detail)` — same pattern for rollback events; throws when `outcome` is absent or not in `['success', 'failure']`
  - `emitQuotaEnforcementEvent(context, detail)` — same pattern for quota enforcement events; throws when `decision` is absent; validates `remainingCapacity` / `denialReason` per decision value
  - `queryAuditRecords(context, params)` — asserts caller `tenantId` and `workspaceId` match route scope before executing query; applies mandatory pagination (`limit` max 200, default 50); returns `AuditPage`; throws `AUDIT_SCOPE_VIOLATION` on scope mismatch
  - `queryRollbackEvidence(context, params)` — scope-validated query restricted to `action_type = 'function.rolled_back'`; same pagination contract
  - `queryQuotaEnforcement(context, params)` — scope-validated query restricted to `action_type = 'function.quota_enforced'`; same pagination contract
  - `buildAuditCoverageReport(adminContext, params)` — superadmin-only; queries event type presence/absence per active scope; response `AuditCoverageReport` contains no function-specific business field values (`detail`, actor names, or function identifiers)
  - `summarizeFunctionAuditSurface()` — introspectable surface summary for admin inventory consumers

- [x] T014 [P] Extend `apps/control-plane/src/functions-admin.mjs` additively:
  - import and re-export `AUDIT_ACTION_TYPES`, `AUDIT_SCOPE_ERROR_CODES`, `emitDeploymentAuditEvent`, `emitAdminActionAuditEvent`, `emitRollbackEvidenceEvent`, `emitQuotaEnforcementEvent` from `./functions-audit.mjs`
  - extend `summarizeFunctionsAdminSurface()` to include three new resource kind entries: `function_deployment_audit` (actions: `['list']`), `function_rollback_evidence` (actions: `['list']`), `function_quota_enforcement_audit` (actions: `['list']`)
  - extend `getOpenWhiskCompatibilitySummary()` to add `functionAuditSupported: true` at the same level as `functionVersioningSupported`, `workspaceSecretsSupported`, and `definitionImportExportSupported`
  - do not modify existing route listing functions, console backend identity exports, import/export exports, or T01–T05 exports

- [x] T015 [P] Write `tests/unit/functions-audit.test.mjs` (Node `node:test`, no external dependencies):
  - `AUDIT_ACTION_TYPES` exports all four required type identifiers
  - `AUDIT_SCOPE_ERROR_CODES` exports both error codes: `SCOPE_VIOLATION` and `COVERAGE_UNAUTHORIZED`
  - `emitDeploymentAuditEvent` throws when `actor` is absent
  - `emitDeploymentAuditEvent` throws when `tenantId` is absent
  - `emitDeploymentAuditEvent` throws when `workspaceId` is absent
  - console-backend-originated deployment event includes `initiating_surface: 'console_backend'` when context carries the T04 surface identifier
  - `emitRollbackEvidenceEvent` throws when `outcome` is absent
  - `emitRollbackEvidenceEvent` throws when `outcome` is not in `['success', 'failure']`
  - `emitRollbackEvidenceEvent` succeeds when `outcome = 'failure'` (evidence for failed rollbacks must not be suppressed)
  - `emitQuotaEnforcementEvent` throws when `decision` is absent
  - `emitQuotaEnforcementEvent` throws when `decision = 'denied'` and `denialReason` is absent
  - `emitQuotaEnforcementEvent` throws when `decision = 'allowed'` near threshold and `remainingCapacity` is absent
  - `queryAuditRecords` throws `AUDIT_SCOPE_VIOLATION` when caller `tenantId` does not match route scope
  - `queryAuditRecords` throws `AUDIT_SCOPE_VIOLATION` when caller `workspaceId` does not match route scope
  - `queryAuditRecords` rejects `limit > 200` before execution
  - `buildAuditCoverageReport` returns an object with a `scopeCoverage` array containing no function-specific business fields (`detail`, function names, or actor identities)
  - `summarizeFunctionAuditSurface` returns a non-empty object

- [x] T016 [P] Extend `tests/unit/functions-admin.test.mjs` with additive assertions for:
  - `function_deployment_audit`, `function_rollback_evidence`, and `function_quota_enforcement_audit` resource kinds present in `summarizeFunctionsAdminSurface()` output
  - `getOpenWhiskCompatibilitySummary()` returns `functionAuditSupported: true`
  - all six re-exported audit identifiers are present and match expected shapes
  - no regression in existing admin surface assertions

**Checkpoint**: Control-plane module and functions admin surface are covered at the unit layer.

---

## Phase 6: Contract Tests, Resilience Tests, DB Migration, E2E Scaffold, and Validation Gate

**Purpose**: Prove schema compliance, scope isolation, all four denial scenarios, failed-rollback record invariant, and cursor-scope binding; apply the PostgreSQL migration; then validate the branch is ready for PR/CI handoff.

- [x] T017 Write `tests/contracts/functions-audit.contract.test.mjs` following the pattern of `tests/contracts/functions-import-export.contract.test.mjs`:
  - `DeploymentAuditEntry` schema satisfies the `function_admin_result` contract baseline fields
  - `RollbackEvidenceRecord` includes `sourceVersion`, `targetVersion`, and `outcome`
  - `QuotaEnforcementRecord` includes `decision` and `quotaDimension`
  - `AuditCoverageReport` does not contain function-specific business data fields (`detail`, function names, actor names)
  - audit query rejection for scope violation produces an `ErrorResponse`-compatible shape with a `GW_`-prefixed code
  - all four new route entries exist in `services/internal-contracts/src/public-route-catalog.json` with the correct `tenantBinding` and `workspaceBinding` values
  - coverage route (`getFunctionAuditCoverage`) has `tenantBinding: 'none'` and `workspaceBinding: 'none'`
  - `audit_query_context` propagation target exists in `services/internal-contracts/src/authorization-model.json` with `query_scope` marked required
  - all four `AUTHZ-FN-AUD-*` denial scenario IDs are present in `authorization-model.json`
  - `summarizeFunctionsAdminSurface()` includes `function_deployment_audit`, `function_rollback_evidence`, and `function_quota_enforcement_audit` resource kinds
  - `getOpenWhiskCompatibilitySummary()` returns `functionAuditSupported: true`
  - five new domain entities and three new business invariants are present in `services/internal-contracts/src/domain-model.json`

- [x] T018 [P] Write `tests/resilience/functions-audit-authorization.test.mjs`:
  - `AUTHZ-FN-AUD-001`: audit query against a different tenant's workspace — denied, response does not reveal foreign record content
  - `AUTHZ-FN-AUD-002`: audit query against a workspace in the same tenant but outside the caller's authorized workspace — denied
  - `AUTHZ-FN-AUD-003`: non-superadmin calls `GET /v1/admin/functions/audit/coverage` — HTTP 403, `GW_`-prefixed error code, `AUDIT_COVERAGE_UNAUTHORIZED`
  - `AUTHZ-FN-AUD-004`: audit query with `limit = 201` — rejected before database execution, response contains error code indicating limit exceeded
  - rollback evidence query after a failed rollback returns a record with `outcome: 'failure'` rather than an absent entry (invariant `BI-FN-AUD-003`)
  - quota enforcement denial record for workspace A does not appear in audit query results for an authorized operator in workspace B of the same tenant (invariant `BI-FN-AUD-002`)
  - cursor presented against a different workspace scope than the one that issued it is rejected with `AUDIT_SCOPE_VIOLATION` (cursor-scope binding)

- [x] T019 [P] Apply PostgreSQL migration for the `function_audit_records` table inside the existing Helm migration job:
  - table: `function_audit_records`
  - columns: `id uuid PK`, `action_type varchar(64) NOT NULL`, `tenant_id uuid NOT NULL`, `workspace_id uuid NOT NULL`, `function_id uuid nullable`, `actor varchar(256) NOT NULL`, `correlation_id varchar(128)`, `initiating_surface varchar(64)`, `detail jsonb`, `created_at timestamptz NOT NULL`, `schema_version varchar(16) NOT NULL`
  - compound index on `(tenant_id, workspace_id, action_type, created_at)` to support all query filter combinations
  - individual indexes on `tenant_id`, `workspace_id`, `correlation_id`, and `created_at` for selective queries
  - no cross-tenant view or cross-tenant index is created
  - migration file location: follow the existing Helm migration job file naming convention under the repo's migration directory

- [x] T020 [P] Add a describe-only E2E scaffold in `tests/e2e/functions/functions-audit.test.mjs`:
  - happy path: authorized function deployment produces a queryable `DeploymentAuditEntry` within the correct tenant and workspace scope
  - happy path: rollback evidence record is queryable and contains `outcome: 'failure'` after a failed rollback
  - happy path: quota enforcement denial record is queryable after a guardrail blocks a function action
  - negative path: cross-tenant audit query is denied with HTTP 403 and an `ErrorResponse` body that reveals no foreign record content

- [x] T021 Run the full root validation suite from the repo root and fix any contract or test drift before proceeding to push/PR work:
  - `npm run generate:public-api`
  - `npm run validate:public-api`
  - `npm run validate:openapi`
  - `npm run test:unit`
  - `npm run test:adapters`
  - `npm run test:contracts`
  - `npm run test:resilience`
  - `npm run lint`

---

## Parallelization Notes

- T005, T006, and T007 can all proceed in parallel once entity names and denial scenario IDs from T004 are agreed.
- T008 can proceed in parallel with T005, T006, and T007 once T004 entity names are stable.
- T009 can begin as soon as T007 (route catalog shape) is stable; it does not block T011.
- T010 must follow T009.
- T011 and T012 can begin in parallel with T009 once the event type constant names are stable.
- T013 depends on T011 adapter exports being stable but can proceed in parallel with T009 and T010.
- T014, T015, and T016 can proceed in parallel once T013 module shape is stable; T014 also depends on T013.
- T017 and T018 can proceed in parallel once T011, T013, and T014 are merged.
- T019 (DB migration) can proceed at any time after entity schema columns are agreed from T004; it does not block code steps.
- T020 (E2E scaffold) can proceed at any time after T009.
- T021 must be the last step before the PR is opened.

---

## Done Criteria

- Every function deployment produces a queryable `DeploymentAuditEntry` within the correct tenant and workspace scope (SC-001).
- Every administrative action on a function produces a queryable `AdminActionAuditEntry` with the correct action type and attribution (SC-002).
- Every rollback event — successful or failed — produces a `RollbackEvidenceRecord` that an auditor can retrieve independently; a failed rollback produces `outcome: 'failure'`, not an absent record (SC-003, `BI-FN-AUD-003`).
- Every quota enforcement decision (denial or near-threshold allowance) produces a queryable `QuotaEnforcementRecord` (SC-004).
- Audit queries from one tenant or workspace do not return records belonging to another tenant or workspace (`BI-FN-AUD-002`, SC-005).
- A superadmin can confirm audit coverage completeness without accessing tenant-specific function data (SC-006).
- All new unit, adapter, contract, and resilience tests pass.
- No existing tests regress across `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run test:resilience`.
- All four `AUTHZ-FN-AUD-*` denial scenarios are present in `services/internal-contracts/src/authorization-model.json` and covered by passing resilience tests.
- `getOpenWhiskCompatibilitySummary()` returns `functionAuditSupported: true`.
- `summarizeFunctionsAdminSurface()` includes `function_deployment_audit`, `function_rollback_evidence`, and `function_quota_enforcement_audit` resource kinds.
- Scope remains bounded to US-FN-03-T06; no sibling scope (T01–T05) is absorbed.

---

## Expected Evidence

- New file `apps/control-plane/src/functions-audit.mjs` present and importable.
- Additive diff to `services/adapters/src/openwhisk-admin.mjs` showing only the two constants (`OPENWHISK_AUDIT_ACTION_TYPES`, `OPENWHISK_AUDIT_SCHEMA_VERSION`) and four new event builder functions; no existing exports modified.
- Additive diff to `apps/control-plane/src/functions-admin.mjs` showing the six re-exports and the two compatibility summary extensions.
- Additive diff to `apps/control-plane/openapi/families/functions.openapi.json` showing four new operation objects and seven new schema components; no existing paths or schemas removed.
- Additive diff to `services/internal-contracts/src/authorization-model.json` showing `audit_query_context` propagation target and four `AUTHZ-FN-AUD-*` denial scenarios.
- Additive diff to `services/internal-contracts/src/internal-service-map.json` showing two new `control_api` responsibility entries.
- Additive diff to `services/internal-contracts/src/public-route-catalog.json` showing four new route entries.
- Additive diff to `services/internal-contracts/src/domain-model.json` showing five new entity definitions and three new business invariants.
- New test files: `tests/unit/functions-audit.test.mjs`, `tests/contracts/functions-audit.contract.test.mjs`, `tests/resilience/functions-audit-authorization.test.mjs`, `tests/e2e/functions/functions-audit.test.mjs` (scaffold only).
- Additive assertions in `tests/adapters/openwhisk-admin.test.mjs` covering all four event builders and both constants.
- PostgreSQL migration script for `function_audit_records` table and its compound index present in the Helm migration job directory.
- A representative `DeploymentAuditEntry` from a console-backend-originated deployment carries `initiating_surface: 'console_backend'` alongside the original actor and scope fields.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, `npm run test:resilience`, and `npm run lint` captured before the PR is opened.
