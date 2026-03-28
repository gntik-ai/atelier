# Feature Specification: Storage Audit for Administrative and Data-Plane Operations

**Feature Branch**: `022-storage-audit-ops`
**Task**: US-STO-03-T04
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-03 — Credenciales programáticas, uso agregado, import/export y auditoría de storage
**Requirements traceability**: RF-STO-018
**Dependencies**: US-STO-01 (full chain: specs 007–012), US-STO-03-T01 (spec 019), US-STO-03-T02 (spec 020), US-STO-03-T03 (spec 021), US-OBS-03
**Created**: 2026-03-28
**Status**: Specified

## Repo-local dependency map

| Concern | Module / Path | Relevance |
|---|---|---|
| Bucket & object mutation events | `services/adapters/src/storage-bucket-object-ops.mjs` | `buildStorageMutationEvent` produces per-operation event records with `auditEnvelope` (actorUserId, correlationId, outcome, occurredAt). Audit ops formalizes and extends this pattern into a queryable, filterable audit trail. |
| Error audit events | `services/adapters/src/storage-error-taxonomy.mjs` | `buildStorageErrorAuditEvent` produces error-level audit records. Audit ops must ingest these alongside success events to provide a complete trail. |
| Event notification audit | `services/adapters/src/storage-event-notifications.mjs` | `buildStorageEventNotificationAuditEvent`, `STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS`. Establishes the existing audit-event shape convention (eventType, action, outcome, actorRef, correlationId, occurredAt). Audit ops aligns with this structure. |
| Scoped credentials (spec 019) | `services/adapters/src/storage-programmatic-credentials.mjs` | `STORAGE_PROGRAMMATIC_CREDENTIAL_STATES`, credential lifecycle events. Every credential-attributed data-plane operation must be traceable to the specific credential and its owning principal. |
| Usage reporting (spec 020) | `services/adapters/src/storage-usage-reporting.mjs` | `buildStorageUsageAuditEvent`. Usage report generation already produces audit events. Audit ops must ingest these into the unified trail. |
| Import/export audit (spec 021) | `services/adapters/src/storage-import-export.mjs` | `buildStorageImportExportAuditEvent`. Import/export lifecycle audit events must be queryable through the unified audit surface. |
| Access policy evaluation | `services/adapters/src/storage-access-policy.mjs` | `evaluateStorageAccessDecision`, `STORAGE_POLICY_ACTIONS`. Policy evaluation outcomes (allow/deny) are audit-relevant for access tracing and denied-request investigation. |
| Tenant storage context | `services/adapters/src/storage-tenant-context.mjs` | Tenant lifecycle events (creation, suspension, deletion, credential rotation) are administrative operations that require audit entries. |
| Capacity quotas | `services/adapters/src/storage-capacity-quotas.mjs` | Quota admission results (admitted / rejected) are audit-relevant administrative decisions. |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Admin surface where audit query endpoints will be added. Already re-exports credential, usage, import/export, and error modules. |
| Functions audit (pattern reference) | `apps/control-plane/src/functions-audit.mjs` | `queryAuditRecords`, `buildAuditCoverageReport`. Establishes the existing audit query and coverage-report pattern in the control plane. Storage audit ops follows a consistent approach. |
| Existing tests | `tests/unit/storage-bucket-object-ops.test.mjs`, `tests/unit/storage-error-taxonomy.test.mjs`, `tests/adapters/storage-event-notifications.test.mjs` | Test patterns and runner conventions (`node --test`). |

---

## 1. Objective and Problem Statement

The storage subsystem already emits audit-relevant events from multiple modules: `buildStorageMutationEvent` for bucket/object operations, `buildStorageErrorAuditEvent` for normalized errors, `buildStorageEventNotificationAuditEvent` for event-notification lifecycle, `buildStorageUsageAuditEvent` for usage report queries, and `buildStorageImportExportAuditEvent` for bulk data movement. Scoped programmatic credentials (spec 019) provide per-credential attribution, and the access policy engine evaluates every data-plane request against workspace defaults and bucket policies.

However, **there is no unified audit surface** that:

- Collects all these heterogeneous audit events into a coherent, queryable trail scoped to tenant/workspace/bucket boundaries.
- Provides structured queries: filter by time range, actor, operation type, outcome, bucket, credential, or correlation ID.
- Covers **administrative operations** (bucket creation/deletion, policy changes, credential lifecycle, quota changes, tenant context mutations) with the same audit rigor as data-plane operations.
- Enables **compliance review**: workspace admins, tenant owners, and superadmins cannot today retrieve a chronological record of who did what, when, and with what outcome across their storage resources.
- Provides **audit coverage reporting**: there is no mechanism to verify that all auditable operation categories are actually producing events, creating a gap in assurance.

Without this task:

- **Workspace admins** cannot investigate who deleted an object, who changed a bucket policy, or which credential was used for a suspicious upload — the events exist in code but are not exposed through a query surface.
- **Tenant owners** cannot produce a tenant-wide audit report for compliance, security review, or incident investigation.
- **Superadmins** cannot perform cross-tenant audit searches during incident response.
- Administrative operations (policy changes, credential revocations, quota adjustments) may lack structured audit events entirely — the existing audit builders focus on data-plane and error events.
- There is no audit coverage metric: the platform cannot demonstrate that 100% of auditable operations produce events.

This task introduces **storage audit ops** — a unified audit event schema, a comprehensive set of administrative-operation audit builders, a queryable audit trail surface, and an audit coverage report, all within multi-tenant isolation boundaries.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Workspace admins** need to query the audit trail for their workspace to investigate who performed specific operations on buckets and objects, review access denials, and verify credential usage patterns. They receive a filterable, chronological audit trail scoped to their workspace.
- **Tenant owners** need a tenant-wide audit view for compliance reporting, security reviews, and cross-workspace incident investigation. They receive audit queries spanning all workspaces in their tenant, with filtering by actor, operation type, outcome, and time range.
- **Developers** need to trace their own operations (especially those performed via programmatic credentials) for debugging and verifying that their automations behave as expected. They receive access to their own audit entries within workspaces they belong to.
- **Superadmins** need cross-tenant audit search for platform-wide incident response, abuse investigation, and compliance enforcement. They receive unrestricted audit query access with the same filtering capabilities.
- **Compliance and security reviewers** (internal to the tenant or platform) need audit completeness assurance — evidence that all auditable operation categories produce events. They receive an audit coverage report that maps operation categories to event production status.
- **Console UI** needs structured audit data to render operation history tables, timeline views, and investigation panels.

### Value delivered

- Provides a single, unified audit query surface for all storage operations — data-plane, administrative, error, and lifecycle events — replacing the current fragmented event production with a consumable trail.
- Enables compliance-grade investigation: who did what, when, on which resource, with which credential, and what was the outcome.
- Covers administrative operations that were previously unaudited or only partially audited.
- Provides audit coverage reporting to verify that the platform's audit promise is fulfilled.
- Supports multi-tenant isolation of audit data with role-based query scoping.

---

## 3. In-Scope Capability

This task covers the **definition of a unified storage audit event schema, production of audit events for administrative operations, a queryable audit trail surface, and an audit coverage report**, all within multi-tenant isolation boundaries.

### In scope

- **Unified audit event schema**: A canonical event shape that all storage audit events conform to, unifying the existing heterogeneous builders (`buildStorageMutationEvent`, `buildStorageErrorAuditEvent`, `buildStorageEventNotificationAuditEvent`, `buildStorageUsageAuditEvent`, `buildStorageImportExportAuditEvent`) and adding new administrative-operation events.
- **Administrative operation audit events**: Structured audit records for operations not yet covered by existing builders:
  - Bucket creation, deletion, and configuration changes.
  - Bucket policy creation, update, and deletion.
  - Workspace storage permission set changes.
  - Tenant storage template changes.
  - Superadmin bucket policy overrides.
  - Credential lifecycle events (already specified in spec 019 FR-018/FR-019, but this task provides the queryable surface and ensures the event shape aligns with the unified schema).
  - Quota configuration changes (tenant-level and workspace-level limit adjustments).
  - Tenant storage context mutations (provisioning, suspension, reactivation, deletion).
- **Audit trail query surface**: API endpoints for querying audit events with filters:
  - Time range (from/to).
  - Actor (user ID, service account ID, or credential ID).
  - Operation category (data-plane, administrative, error, lifecycle).
  - Operation type (specific action, e.g., `object.put`, `bucket.create`, `credential.revoke`).
  - Outcome (`success`, `denied`, `error`, `rejected`).
  - Resource scope (tenant, workspace, bucket, object key prefix).
  - Correlation ID (for tracing related operations).
  - Pagination (cursor-based).
- **Audit event normalization**: A function that takes any existing storage event record (from the heterogeneous builders) and normalizes it into the unified audit schema, enabling backward-compatible ingestion.
- **Audit coverage report**: A function that maps every defined auditable operation category to whether the platform produces an audit event for it, producing a coverage matrix with gaps highlighted.
- **Denied-access audit entries**: When `evaluateStorageAccessDecision` denies a request, an audit event is produced recording the denied action, the actor, the target resource, and the policy source that caused the denial.
- **Credential-attributed audit enrichment**: Every audit event for a data-plane operation performed via a programmatic credential (spec 019) includes the credential identifier alongside the owning principal, enabling per-credential audit queries.
- **Audit data sanitization**: All audit events pass through sanitization to strip secret key material, presigned URLs, and sensitive references (extending the existing `sanitizeAuditString` pattern from `storage-event-notifications.mjs`).

### Out of scope

- **US-STO-03-T01**: Scoped programmatic credentials (specified in spec 019).
- **US-STO-03-T02**: Storage usage reporting (specified in spec 020).
- **US-STO-03-T03**: Object and metadata import/export (specified in spec 021).
- **US-STO-03-T05**: Credential rotation/revocation test suite.
- **US-STO-03-T06**: Documentation of limits, SLAs, and cost considerations.
- **Audit event persistence backend**: This spec defines the audit event schema, production, normalization, and query interface. The choice of persistence backend (Kafka topic, PostgreSQL table, dedicated audit store) is an implementation concern addressed during planning.
- **Audit event retention and archival policies**: Data-retention rules (how long audit events are kept, archival strategy) are a governance decision outside this spec.
- **Real-time audit streaming / alerting**: This spec provides a query-based trail. Real-time streaming to external SIEM systems or alert triggers are future integrations.
- **Console UI for audit**: This spec defines the data contract. Console components for audit investigation panels are a separate task.
- **Tamper-evidence or immutability guarantees**: Audit events are append-only by convention, but cryptographic tamper-evidence (hash chains, signed events) is out of scope.

---

## 4. User Scenarios & Testing

### User Story 1 — Workspace admin queries the audit trail for their workspace (Priority: P1)

A workspace admin queries the storage audit trail for their workspace and receives a chronological list of audit events covering data-plane operations, administrative changes, errors, and access denials, filterable by time range, actor, operation type, and outcome.

**Why this priority**: This is the foundational audit consumption surface. Without queryable audit, all event production is invisible to users. Workspace-level scoping is the most common query pattern.

**Independent Test**: A workspace admin requests audit events for workspace W filtered to the last 24 hours. The response includes events for an object upload, a bucket policy change, and an access denial, all with correct metadata. Events from other workspaces in the same tenant are excluded.

**Acceptance Scenarios**:

1. **Given** workspace W has had the following operations in the last hour: developer D1 uploaded an object to B1 (success), workspace admin A1 updated the bucket policy on B1 (success), developer D2 attempted to delete an object in B1 but was denied by policy, **When** the workspace admin queries audit events for W with no filters, **Then** the response includes at least 3 events in chronological order, each with: `eventType`, `operationType`, `actorId`, `outcome`, `resourceScope` (tenantId, workspaceId, bucketId), `occurredAt`, and `correlationId`. The object upload event includes the credential ID if D1 used a programmatic credential. The denied-access event includes the policy source that caused the denial.
2. **Given** the same workspace, **When** the admin filters by `outcome: denied`, **Then** only the access-denial event is returned.
3. **Given** the same workspace, **When** the admin filters by `actorId: D1`, **Then** only events attributed to developer D1 are returned.
4. **Given** the workspace admin queries workspace W2 (a different workspace they do not administer), **Then** the request is rejected with an authorization error.

---

### User Story 2 — Tenant owner produces a tenant-wide audit report (Priority: P1)

A tenant owner queries the audit trail across all workspaces in their tenant to produce a compliance-grade audit report, filterable by time range, operation category, and resource scope.

**Why this priority**: Tenant-wide audit is required for compliance reporting and cross-workspace investigation. It is the direct answer to the compliance and traceability requirement in the story acceptance criteria.

**Independent Test**: A tenant owner requests all administrative audit events (bucket creation, policy changes, credential lifecycle) across the tenant for the past 7 days. The response includes events from multiple workspaces, correctly tagged with their workspace context.

**Acceptance Scenarios**:

1. **Given** tenant T has workspaces W1 and W2 with audit events in the last 7 days, **When** the tenant owner queries audit events for tenant T filtered by `operationCategory: administrative`, **Then** the response includes administrative events from both W1 and W2 (bucket creations, policy changes, credential lifecycle), each tagged with the workspace identifier, and excludes data-plane events.
2. **Given** the tenant owner filters by `operationType: credential.revoke`, **When** the response is returned, **Then** it includes only credential revocation events across all workspaces, each with the credential identifier, the revoking actor, and the revocation trigger (explicit, cascade, or expiration).
3. **Given** the tenant owner queries for the last 30 days and results exceed a single page, **When** the first page is returned, **Then** it includes a `cursor` for pagination, and a subsequent request with that cursor returns the next page of results without gaps or duplicates.

---

### User Story 3 — Developer traces operations performed with a specific credential (Priority: P1)

A developer queries the audit trail to see all storage operations performed with a specific programmatic credential, enabling debugging and verification of automated workloads.

**Why this priority**: Per-credential traceability is a core value proposition of scoped credentials (spec 019). Without audit query support, credential attribution exists in the data but is inaccessible.

**Independent Test**: A developer queries audit events filtered by their credential ID and receives only operations attributed to that credential, across all buckets the credential was used against.

**Acceptance Scenarios**:

1. **Given** developer D holds credential C1 scoped to `object.put` on bucket B1, and C1 was used for 5 PUT operations and 1 denied GET operation in the last hour, **When** D queries audit events filtered by `credentialId: C1`, **Then** the response includes 6 events: 5 successful PUT events and 1 denied GET event, each tagged with C1 and D's principal ID.
2. **Given** developer D holds credentials C1 and C2, **When** D queries filtered by `credentialId: C1`, **Then** events from C2 are excluded.
3. **Given** developer D queries credential C3 (owned by developer D2), **Then** the request is rejected — a developer can only query audit events for their own credentials within their authorized workspaces.

---

### User Story 4 — Audit event for administrative operations (Priority: P1)

Every administrative storage operation (bucket creation, bucket deletion, policy change, credential lifecycle, quota change, tenant context mutation) produces a structured audit event with the acting principal, target resource, operation details, and outcome.

**Why this priority**: Administrative audit is the gap this task closes. Without it, only data-plane operations and errors have audit coverage.

**Independent Test**: A workspace admin creates a bucket, updates its policy, and a superadmin overrides the policy. Each operation produces an audit event queryable through the audit trail with correct metadata.

**Acceptance Scenarios**:

1. **Given** workspace admin A creates bucket B1 in workspace W, **When** the audit trail is queried, **Then** an event exists with `operationType: bucket.create`, `actorId: A`, `outcome: success`, `resourceScope: {tenantId, workspaceId, bucketId: B1}`, and `occurredAt` timestamp.
2. **Given** workspace admin A updates the bucket policy on B1 (adds a new statement), **When** the audit trail is queried, **Then** an event exists with `operationType: bucket_policy.update`, `actorId: A`, `outcome: success`, and a `changeSummary` indicating the number of statements added/removed/modified (without exposing the full policy document in the audit event).
3. **Given** a superadmin applies a policy override on B1, **When** the audit trail is queried, **Then** an event exists with `operationType: bucket_policy.superadmin_override`, `actorId: <superadmin>`, `outcome: success`, `reason` (as provided by the superadmin), and the target resource scope.
4. **Given** tenant owner adjusts the workspace-level quota for W, **When** the audit trail is queried, **Then** an event exists with `operationType: quota.update`, the old and new limit values per affected dimension, and the acting principal.

---

### User Story 5 — Denied-access events are recorded in the audit trail (Priority: P1)

When a storage access request is denied by the policy engine, an audit event is produced recording the denial with sufficient context for investigation.

**Why this priority**: Denied-access audit is critical for security investigation — it reveals unauthorized access attempts and misconfigured policies.

**Independent Test**: A developer attempts to delete an object without the `object.delete` permission. The denial produces an audit event queryable by the workspace admin, including the denied action, the actor, and the policy source responsible.

**Acceptance Scenarios**:

1. **Given** developer D attempts `object.delete` on bucket B1 in workspace W, and the workspace default policy does not grant `object.delete` to D, **When** the policy engine denies the request, **Then** an audit event is produced with `operationType: access.denied`, `actorId: D`, `requestedAction: object.delete`, `targetResource: {bucketId: B1, objectKey: <key>}`, `policySource: workspace_default`, and `outcome: denied`.
2. **Given** developer D uses programmatic credential C1 for the denied request, **When** the denial audit event is inspected, **Then** it includes `credentialId: C1` alongside `actorId: D`.
3. **Given** the denial is caused by multi-tenant isolation (cross-tenant access attempt), **When** the audit event is produced, **Then** it includes `policySource: isolation_rejection` and the audit event is recorded in the target tenant's trail (if the target tenant exists) as well as a cross-tenant violation marker in the superadmin trail.

---

### User Story 6 — Superadmin performs cross-tenant audit search (Priority: P2)

A superadmin queries audit events across all tenants for incident response, filtering by time range, operation type, and outcome.

**Why this priority**: Cross-tenant audit is a platform-safety capability for incident response. It is less frequent than tenant-level queries but essential for platform-wide investigation.

**Independent Test**: A superadmin searches for all `credential.revoke` events across the platform in the last hour. The response includes revocation events from multiple tenants, each with correct tenant context.

**Acceptance Scenarios**:

1. **Given** credentials were revoked in tenants T1 and T2 in the last hour, **When** the superadmin queries with `operationType: credential.revoke` and time range of the last hour, **Then** the response includes revocation events from both T1 and T2, each with their tenant and workspace identifiers.
2. **Given** the superadmin queries for `outcome: denied` across all tenants, **When** the response is returned, **Then** it includes all access-denial events platform-wide, enabling the superadmin to identify widespread unauthorized access patterns.
3. **Given** the superadmin queries with a `correlationId`, **When** the response is returned, **Then** all events sharing that correlation ID are returned, enabling end-to-end request tracing across operation boundaries.

---

### User Story 7 — Audit coverage report verifies event completeness (Priority: P2)

A tenant owner or superadmin requests an audit coverage report that maps every defined auditable operation category to whether the platform is producing audit events for it, identifying any gaps.

**Why this priority**: Audit assurance is a governance requirement. The report proves that the audit promise is fulfilled and flags any regressions. It depends on the audit schema and event production (P1 stories) being in place.

**Independent Test**: An audit coverage report is generated for a workspace. It lists all operation categories (data-plane, administrative, error, lifecycle) and marks each as `covered` or `gap`. The report correctly identifies that all categories are covered.

**Acceptance Scenarios**:

1. **Given** the platform defines 15 auditable operation categories for storage, **When** a tenant owner requests an audit coverage report for their tenant, **Then** the report lists all 15 categories, each with: category name, example operation types, coverage status (`covered` or `gap`), and the most recent event timestamp for that category (or `null` if no events exist yet).
2. **Given** a hypothetical regression where bucket-deletion events stop being produced, **When** the audit coverage report is generated, **Then** the `bucket.delete` category shows status `gap` if no events have been recorded within the coverage analysis window (configurable, default 30 days).
3. **Given** a superadmin requests a platform-wide audit coverage report, **When** the report is generated, **Then** it aggregates coverage across all tenants and identifies categories that are globally uncovered.

---

### Edge Cases

- **Actor is a system process (not a user)**: Some audit events originate from platform automation (e.g., cascading credential revocation on workspace suspension, automatic credential expiration). These events MUST use a system actor identifier (e.g., `system:lifecycle-cascade`, `system:credential-expiry`) — never a null or empty actor.
- **High-volume data-plane operations**: A workspace with many PUT/GET operations per second generates a high volume of audit events. The audit query surface MUST support pagination and time-range filtering efficiently. The spec does not mandate a specific throughput guarantee — that is an implementation concern.
- **Audit event for a non-existent resource**: If an operation targets a resource that does not exist (e.g., GET on a deleted bucket), the audit event still records the attempt with the resource identifier as provided by the requester, and `outcome: error` with the appropriate error code.
- **Concurrent operations on the same resource**: Audit events are not required to be globally ordered. Within a single correlation ID, events SHOULD be ordered by `occurredAt`. Across unrelated operations, the trail provides eventual ordering by timestamp.
- **Audit query returns no results**: An audit query with filters that match no events returns an empty result set — not an error. The response includes the applied filters for transparency.
- **Sensitive fields in administrative events**: Policy change audit events MUST NOT include the full policy document — only a change summary (statements added/removed/modified count). Quota change events include old and new limit values (these are not secrets). Credential lifecycle events MUST NOT include secret key material.
- **Retroactive audit coverage**: The audit coverage report analyzes event presence, not event completeness. It verifies that the platform is producing events for each category, not that every individual operation was audited (the latter requires log analysis, which is out of scope).

---

## 5. Functional Requirements

### Unified Audit Event Schema

- **FR-001**: The system MUST define a unified storage audit event schema with the following mandatory fields: `eventId` (unique identifier), `eventType` (hierarchical, e.g., `storage.object.put`, `storage.bucket_policy.update`, `storage.access.denied`), `operationCategory` (one of: `data_plane`, `administrative`, `error`, `lifecycle`), `operationType` (specific action), `actorId` (principal who performed the operation), `actorType` (one of: `user`, `service_account`, `system`, `superadmin`), `credentialId` (programmatic credential identifier, or `null` if not credential-based), `outcome` (one of: `success`, `denied`, `error`, `rejected`), `resourceScope` (object containing `tenantId`, `workspaceId`, `bucketId` where applicable), `occurredAt` (ISO-8601 timestamp), `correlationId` (request-level trace identifier).
- **FR-002**: The unified schema MUST support optional fields: `objectKey` (for object-level operations), `changeSummary` (for administrative mutations), `errorCode` (for error/denial events), `policySource` (for access-decision events), `triggerSource` (for lifecycle events, e.g., `workspace_suspension`, `credential_expiry`).
- **FR-003**: All audit events MUST pass through a sanitization function that strips secret key material, presigned URLs, and sensitive references from all string fields, consistent with the existing `sanitizeAuditString` pattern.

### Audit Event Normalization

- **FR-004**: The system MUST provide a normalization function that converts any existing storage event record (from `buildStorageMutationEvent`, `buildStorageErrorAuditEvent`, `buildStorageEventNotificationAuditEvent`, `buildStorageUsageAuditEvent`, `buildStorageImportExportAuditEvent`) into the unified audit event schema.
- **FR-005**: The normalization function MUST preserve all audit-relevant fields from the source event and map them to the unified schema. Fields that do not exist in the source MUST be set to `null`, not omitted.
- **FR-006**: The normalization function MUST assign the correct `operationCategory` based on the source event type: mutation events → `data_plane`, error events → `error`, notification audit → `lifecycle`, usage audit → `administrative`, import/export audit → `data_plane`.

### Administrative Operation Audit Builders

- **FR-007**: The system MUST produce audit events for the following administrative operations, each conforming to the unified schema:
  - Bucket creation (`bucket.create`)
  - Bucket deletion (`bucket.delete`)
  - Bucket policy creation (`bucket_policy.create`)
  - Bucket policy update (`bucket_policy.update`)
  - Bucket policy deletion (`bucket_policy.delete`)
  - Superadmin bucket policy override (`bucket_policy.superadmin_override`)
  - Workspace storage permission set update (`workspace_permissions.update`)
  - Tenant storage template update (`tenant_template.update`)
  - Quota configuration change — tenant-level (`quota.tenant_update`)
  - Quota configuration change — workspace-level (`quota.workspace_update`)
  - Tenant storage context provisioning (`tenant_context.provision`)
  - Tenant storage context suspension (`tenant_context.suspend`)
  - Tenant storage context reactivation (`tenant_context.reactivate`)
  - Tenant storage context deletion (`tenant_context.delete`)
- **FR-008**: Administrative audit events MUST include a `changeSummary` field that describes the nature of the change without exposing full document payloads. For policy changes: count of statements added, removed, modified. For quota changes: old and new limit values per affected dimension.
- **FR-009**: Administrative audit events for lifecycle triggers (suspension, deletion) that cause cascading effects (e.g., credential revocation) MUST include a `cascadeTriggered` boolean and a `cascadeScope` describing what was affected (e.g., `{credentialsRevoked: 12, workspacesAffected: 3}`).

### Denied-Access Audit

- **FR-010**: When the access policy engine (`evaluateStorageAccessDecision`) produces a `deny` outcome, the system MUST produce an audit event with `operationType: access.denied`, the requested action, the target resource scope, the acting principal (and credential ID if applicable), and the `policySource` that caused the denial (e.g., `bucket_policy`, `workspace_default`, `isolation_rejection`).
- **FR-011**: Denied-access audit events MUST NOT include the full policy document that caused the denial — only the policy source type and, optionally, the specific statement ID that matched.

### Credential-Attributed Audit Enrichment

- **FR-012**: Every audit event for a data-plane operation performed via a programmatic credential (spec 019) MUST include `credentialId` set to the credential's unique identifier, in addition to `actorId` set to the credential's owning principal.
- **FR-013**: Audit events for credential lifecycle operations (creation, rotation, revocation, expiration) MUST include `credentialId` and `operationType` matching the lifecycle action (e.g., `credential.create`, `credential.rotate`, `credential.revoke`, `credential.expire`).

### Audit Trail Query Surface

- **FR-014**: The system MUST provide a query function that returns audit events matching a set of filters, with cursor-based pagination.
- **FR-015**: Supported query filters: `tenantId` (mandatory for non-superadmin queries), `workspaceId` (optional), `bucketId` (optional), `actorId` (optional), `credentialId` (optional), `operationCategory` (optional), `operationType` (optional), `outcome` (optional), `correlationId` (optional), `fromTimestamp` (optional, inclusive), `toTimestamp` (optional, exclusive), `objectKeyPrefix` (optional, for object-level filtering).
- **FR-016**: Query results MUST be ordered by `occurredAt` descending (newest first) by default, with an option to request ascending order.
- **FR-017**: Each query response MUST include: an array of audit events conforming to the unified schema, a `cursor` for the next page (or `null` if no more results), the total result count (or an estimate if exact counting is expensive), and the applied filters for transparency.
- **FR-018**: The query function MUST accept a `limit` parameter (default: 50, maximum: 500) controlling page size.

### Authorization & Multi-Tenant Isolation

- **FR-019**: Audit trail queries MUST enforce scope-based authorization:
  - Developers may query events within workspaces they belong to, filtered to their own `actorId` or their own `credentialId`.
  - Workspace admins may query all events within their workspace without actor restriction.
  - Tenant owners may query all events across all workspaces in their tenant.
  - Superadmins may query events across any tenant.
- **FR-020**: Audit data MUST be fully isolated by tenant boundary. No audit event from one tenant is visible or accessible to another tenant, except through the superadmin query scope.
- **FR-021**: Within a tenant, workspace-level isolation applies: a workspace admin for W1 cannot see audit events from W2 unless they also hold tenant-owner or superadmin roles.

### Audit Coverage Report

- **FR-022**: The system MUST provide a function that produces an audit coverage report listing every defined auditable operation category for storage.
- **FR-023**: The audit coverage report MUST include, for each operation category: category identifier, display name, example operation types within the category, coverage status (`covered` if at least one event exists within the analysis window, `gap` otherwise), and the most recent event timestamp for that category (or `null`).
- **FR-024**: The auditable operation categories MUST include at minimum: `object.read`, `object.write`, `object.delete`, `object.list`, `bucket.create`, `bucket.delete`, `bucket_policy.change`, `credential.lifecycle`, `quota.change`, `tenant_context.lifecycle`, `access.denied`, `import_export`, `usage_report`, `event_notification.lifecycle`, `error`.
- **FR-025**: The audit coverage report MUST accept a `scopeType` (tenant or platform) and a `windowDays` parameter (default: 30) defining the analysis lookback window.

### Audit Event for Audit Queries

- **FR-026**: Every audit trail query MUST itself produce a meta-audit event recording: the querying principal, the query scope (filters applied), and the timestamp. This meta-event MUST NOT include the query results.

### Error Handling

- **FR-027**: Audit-related errors MUST follow the `storage-error-taxonomy` conventions. New error codes introduced: `AUDIT_SCOPE_UNAUTHORIZED` (query scope exceeds the principal's authorization), `AUDIT_QUERY_INVALID` (malformed filter parameters), `AUDIT_COVERAGE_UNAVAILABLE` (coverage report cannot be generated).

### Key Entities

- **Unified Storage Audit Event**: A canonical audit record for any storage operation. Key attributes: eventId, eventType, operationCategory, operationType, actorId, actorType, credentialId, outcome, resourceScope (tenantId, workspaceId, bucketId, objectKey), changeSummary, errorCode, policySource, triggerSource, correlationId, occurredAt.
- **Audit Trail Query**: A parameterized request for audit events. Key attributes: scope filters (tenant, workspace, bucket, actor, credential, operation, outcome, time range, correlation ID), pagination (cursor, limit, sort order).
- **Audit Coverage Report**: A matrix mapping auditable operation categories to event production status. Key attributes: scope (tenant or platform), analysis window, category list with coverage status and last-event timestamps.

---

## 6. Business Rules and Governance

- The audit trail is an **append-only, read-only surface for consumers**. Audit events cannot be modified or deleted through the API. Retention and archival are administrative concerns managed outside this spec.
- The unified audit schema is the **canonical shape** for all storage audit data exposed through the query surface. Internal event production may use module-specific builders, but the query surface always returns events in the unified schema.
- Audit queries are themselves audited (meta-audit). This prevents silent audit trail enumeration and supports forensic analysis of who reviewed audit data.
- Developers can only see their own events within their workspaces. This is more restrictive than workspace-admin access, which sees all events in the workspace. The distinction prevents developers from discovering other developers' operations via the audit trail unless they hold admin privileges.
- Administrative audit events include change summaries, not full before/after snapshots. This balances audit utility with event payload size and sensitivity. Full before/after snapshots are an implementation-level enhancement that may be added later behind a configuration flag.
- The audit coverage report is a best-effort analysis tool, not a certification mechanism. It detects the presence of events per category, not the completeness of coverage for every individual operation.
- System-originated events (cascading revocations, automatic expirations) use a well-known system actor prefix (`system:`) to distinguish them from human- or credential-initiated operations.

---

## 7. Acceptance Criteria

1. A workspace admin can query the storage audit trail for their workspace and receive events filtered by time range, actor, operation type, and outcome, with cursor-based pagination.
2. A tenant owner can query audit events across all workspaces in their tenant with the same filtering capabilities.
3. A developer can query audit events for their own operations and credentials within workspaces they belong to.
4. A superadmin can query audit events across any tenant without restriction.
5. Every administrative storage operation (bucket creation/deletion, policy changes, credential lifecycle, quota changes, tenant context lifecycle) produces an audit event conforming to the unified schema.
6. Denied-access attempts produce audit events with the denied action, actor, target resource, credential (if applicable), and policy source.
7. Data-plane operations performed via programmatic credentials include the credential ID in the audit event, enabling per-credential audit queries.
8. The audit coverage report lists all defined auditable operation categories and correctly identifies `covered` vs. `gap` status based on event presence within the analysis window.
9. Audit events from heterogeneous existing builders are normalized into the unified schema and queryable through the same audit trail surface.
10. Audit data is fully tenant-isolated: a workspace admin in tenant T1 cannot see any audit events from tenant T2.
11. Audit data is workspace-isolated within a tenant: a workspace admin for W1 cannot see W2's events unless they hold tenant-owner or superadmin roles.
12. Developers cannot see other developers' audit events within the same workspace — developer-level queries are restricted to the querying principal's own actor ID and credentials.
13. All audit events pass through sanitization: no secret key material, presigned URLs, or sensitive references appear in any audit event.
14. Every audit trail query produces a meta-audit event recording who queried what scope and when.
15. Administrative change audit events include a `changeSummary` (not full document payloads) describing the nature of the change.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The existing audit event builders (`buildStorageMutationEvent`, `buildStorageErrorAuditEvent`, `buildStorageEventNotificationAuditEvent`, `buildStorageUsageAuditEvent`, `buildStorageImportExportAuditEvent`) continue to produce events in their current shapes. The normalization function adapts them to the unified schema without requiring changes to the source modules.
- The access policy engine (`evaluateStorageAccessDecision`) can be extended or wrapped to emit denied-access audit events without modifying its core evaluation logic — the audit emission is a side effect at the call site, not inside the pure policy evaluator.
- The control-plane pattern established by `functions-audit.mjs` (`queryAuditRecords`, `buildAuditCoverageReport`) is the precedent for the storage audit query and coverage report. The storage audit surface follows a consistent approach.
- The `auditEnvelope` pattern (with `actorUserId`, `correlationId`, `outcome`, `occurredAt`) already present in `buildStorageMutationEvent` maps directly to fields in the unified schema.
- The programmatic credential record (spec 019) includes a unique identifier that can be embedded in audit events without exposing the secret key.

### Risks

- **Audit event volume**: High-throughput storage workloads (many object PUTs/GETs per second) generate proportional audit events. Mitigation: the spec defines the schema and query surface, not the persistence strategy. Implementation should consider append-optimized storage and index strategies appropriate for the expected event volume.
- **Normalization complexity**: The existing builders produce events with different shapes. Normalization must handle each variant correctly. Mitigation: the normalization function is testable per source type, and the unified schema includes `null` fallbacks for fields not present in all source events.
- **Meta-audit recursion**: Audit queries produce meta-audit events, which could themselves trigger further meta-events. Mitigation: meta-audit events (`operationType: audit.query`) are NOT themselves subject to meta-auditing. The system explicitly excludes `audit.query` events from triggering further audit events.
- **Denied-access event flood**: A misconfigured client repeatedly hitting denied endpoints could generate a flood of denial events. Mitigation: this is a rate-limiting concern at the API gateway (APISIX) layer, not an audit-schema concern. The audit surface faithfully records denials; rate limiting prevents abuse.

### Blocking questions

None identified. The prerequisite surfaces (mutation events, error events, credential attribution, policy evaluation, import/export audit, usage audit, functions-audit pattern) are specified or implemented.

---

## 9. Success Criteria

- **SC-001**: A workspace admin can retrieve filtered audit events for their workspace in under 5 seconds for queries covering up to 30 days and returning up to 500 events per page.
- **SC-002**: 100% of defined administrative operation categories produce audit events conforming to the unified schema (verifiable by audit coverage report showing zero gaps).
- **SC-003**: 100% of denied-access attempts produce audit events attributable to the acting principal and, where applicable, the programmatic credential.
- **SC-004**: Audit events from all existing builders (`buildStorageMutationEvent`, `buildStorageErrorAuditEvent`, `buildStorageEventNotificationAuditEvent`, `buildStorageUsageAuditEvent`, `buildStorageImportExportAuditEvent`) normalize into the unified schema without data loss of audit-relevant fields.
- **SC-005**: No secret key material, presigned URL, or sensitive reference appears in any audit event (verifiable by automated sanitization scan).
- **SC-006**: Audit data is fully tenant-isolated — no cross-tenant audit data leakage (verifiable by automated authorization test).
