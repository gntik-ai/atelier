# falcone Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-01

## Active Technologies
- Node.js 20+ (ESM modules), aligned with existing project standard (072-workflow-e2e-compensation)
- PostgreSQL (relational workflow/audit data), MongoDB (document state) (072-workflow-e2e-compensation)
- Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets + Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules (001-function-versioning-rollback)
- PostgreSQL access via `pg`, Kafka publication via `kafkajs`, OpenWhisk action wrappers for async operation lifecycle (073-async-job-status-model)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrapper patterns establecidos en T01/T02 (075-idempotent-retry-dedup)
- PostgreSQL (idempotency_key_records, retry_attempts + extensión de async_operations), Kafka (eventos auditables) (075-idempotent-retry-dedup)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (existing `services/provisioning-orchestrator`), React 18 + Tailwind CSS + shadcn/ui (console) (089-api-key-rotation)
- PostgreSQL (rotation state, policy, history), Keycloak (credential lifecycle), APISIX (gateway consumer key verification) (089-api-key-rotation)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `node:test` (test runner nativo Node 20), `node:assert`, `undici` (cliente HTTP para llamadas a APISIX/API), `kafkajs` (verificación de eventos de auditoría), `pg` (consultas de estado para fixtures y auditoría), cliente Vault HTTP (`node-vault` o `undici` directo), `@in-falcone/internal-contracts` (schemas de contratos de auditoría) (096-security-hardening-tests)
- PostgreSQL (lectura de tablas de auditoría: `scope_enforcement_denials`, `privilege_domain_denials`, `secret_version_states`), Kafka (consumo de audit topics para verificar emisión), Vault (API HTTP para bootstrap de secretos en fixtures) (096-security-hardening-tests)
- Node.js 20+ ESM (`"type": "module"`), React 18 + TypeScript for console integrations + `pg` (PostgreSQL), `kafkajs` (audit events), `undici` (integration/API tests), React Testing Library + vitest (console tests), Apache OpenWhisk action wrappers, existing APISIX + Keycloak auth layers (100-plan-change-impact-history)
- PostgreSQL (`tenant_plan_assignments`, `plans`, `quota_dimension_catalog`, `plan_audit_events` + new history/snapshot tables), optional read-only usage collectors backed by PostgreSQL/MongoDB/service APIs, Kafka for audit fan-out (100-plan-change-impact-history)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (established in `services/provisioning-orchestrator`) (103-hard-soft-quota-overrides)
- PostgreSQL — extends `plans` and `quota_dimension_catalog` from 097/098; new tables `quota_overrides`, `quota_enforcement_log` (103-hard-soft-quota-overrides)
- PostgreSQL — depends on `quota_dimension_catalog`, `quota_overrides`, `plans`, `tenant_plan_assignments` (T01) and `boolean_capability_catalog` (T02); new table `workspace_sub_quotas` (105-effective-limit-resolution)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + React 18 + TypeScript en consola + `pg`, `kafkajs`, `undici`, `ajv`, React + Tailwind CSS + shadcn/ui (117-tenant-reprovision-from-export)
- PostgreSQL (lock + auditoría); artefacto procesado en memoria; dependencias externas Keycloak, Kafka, MongoDB, S3-compatible, OpenWhisk (117-tenant-reprovision-from-export)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `node:test`, `node:assert`, `undici` (cliente HTTP para llamadas a APISIX), `kafkajs` (verificación de eventos de auditoría), `pg` (consultas de estado para fixtures y seed), credenciales de `service_account` con scope `platform:admin:config:export` y `platform:admin:config:reprovision` (119-sandbox-restore-functional-tests)
- PostgreSQL (consultas de fixture/seed y verificación de auditoría); los tenants de referencia y destino se crean/destruyen vía APIs del producto — sin acceso directo a las bases de datos internas de los subsistemas (119-sandbox-restore-functional-tests)
- N/A — artefacto de documentación puro (Markdown) + Ninguna dependencia de runtime; referencia cruzada con especificaciones de T01–T05 como fuente de verdad (120-config-vs-data-restore-differences)

## Project Structure

```text
src/
tests/
services/provisioning-orchestrator/src/{models,repositories,events,actions,migrations}
```

## Commands

# Add commands for Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets

## Code Style

Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets: Follow standard conventions

## Recent Changes
- 120-config-vs-data-restore-differences: Added N/A — artefacto de documentación puro (Markdown) + Ninguna dependencia de runtime; referencia cruzada con especificaciones de T01–T05 como fuente de verdad
- 119-sandbox-restore-functional-tests: Added Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `node:test`, `node:assert`, `undici` (cliente HTTP para llamadas a APISIX), `kafkajs` (verificación de eventos de auditoría), `pg` (consultas de estado para fixtures y seed), credenciales de `service_account` con scope `platform:admin:config:export` y `platform:admin:config:reprovision`
- 117-tenant-reprovision-from-export: Added Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + React 18 + TypeScript en consola + `pg`, `kafkajs`, `undici`, `ajv`, React + Tailwind CSS + shadcn/ui

## Async Operation Idempotency & Retry

- New PostgreSQL entities: `idempotency_key_records` (tenant-scoped dedup ledger) and `retry_attempts` (attempt history for failed async operations)
- `async_operations` now tracks `attempt_count` and optional `max_retries`
- New OpenWhisk action: `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs`
- Existing create action now supports idempotency-key deduplication with `X-Idempotent-Replayed` and `X-Idempotent-Params-Mismatch` response headers
- New Kafka audit topics: `console.async-operation.deduplicated` and `console.async-operation.retry-requested`
- New environment variables: `IDEMPOTENCY_KEY_TTL_HOURS`, `OPERATION_DEFAULT_MAX_RETRIES`, `IDEMPOTENCY_KEY_MAX_LENGTH`

<!-- MANUAL ADDITIONS START -->
## Functional Config Export (115-functional-config-export)

- **New files (provisioning-orchestrator)**:
  - `services/provisioning-orchestrator/src/collectors/types.mjs` — shared types (`CollectorResult`, `ExportArtifact`, `DomainStatus`) and `redactSensitiveFields()` helper
  - `services/provisioning-orchestrator/src/collectors/registry.mjs` — collector registry by domain key, feature-gated
  - `services/provisioning-orchestrator/src/collectors/iam-collector.mjs` — Keycloak Admin REST API collector
  - `services/provisioning-orchestrator/src/collectors/postgres-collector.mjs` — PostgreSQL metadata collector (`information_schema`/`pg_catalog`)
  - `services/provisioning-orchestrator/src/collectors/mongo-collector.mjs` — MongoDB metadata collector
  - `services/provisioning-orchestrator/src/collectors/kafka-collector.mjs` — Kafka topics/ACLs/consumer groups collector
  - `services/provisioning-orchestrator/src/collectors/functions-collector.mjs` — OpenWhisk functions collector
  - `services/provisioning-orchestrator/src/collectors/s3-collector.mjs` — S3-compatible storage collector
  - `services/provisioning-orchestrator/src/actions/tenant-config-export.mjs` — main export orchestrator action
  - `services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs` — auxiliary domains endpoint
  - `services/provisioning-orchestrator/src/repositories/config-export-audit-repository.mjs` — audit log data access
  - `services/provisioning-orchestrator/src/events/config-export-events.mjs` — Kafka event publisher (fire-and-forget)
  - `services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql` — DDL for `config_export_audit_log`
- **New files (web-console)**:
  - `apps/web-console/src/api/configExportApi.ts` — API client + TypeScript types
  - `apps/web-console/src/components/ConfigExportDomainSelector.tsx` — domain checkbox selector
  - `apps/web-console/src/components/ConfigExportResultPanel.tsx` — result display + JSON download
  - `apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx` — export page
- **New APISIX routes** (`services/gateway-config/routes/backup-admin-routes.yaml`):
  - `POST /v1/admin/tenants/{tenant_id}/config/export` → `tenant-config-export` action (30s timeout)
  - `GET /v1/admin/tenants/{tenant_id}/config/export/domains` → `tenant-config-export-domains` action (10s timeout)
- **New Keycloak scope** (`services/keycloak-config/scopes/backup-scopes.yaml`):
  - `platform:admin:config:export` — assigned to `superadmin`, `sre`, `service_account`; NOT assigned to `tenant_owner`
- **New PostgreSQL table**: `config_export_audit_log` (audit metadata only; artifact not stored)
- **New Kafka topic**: `console.config.export.completed` (90d retention)
- **Environment variables** (19 total): `CONFIG_EXPORT_KEYCLOAK_ADMIN_URL`, `CONFIG_EXPORT_KEYCLOAK_REALM`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_ID`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET`, `CONFIG_EXPORT_PG_DATABASE_URL`, `CONFIG_EXPORT_MONGO_URI`, `CONFIG_EXPORT_KAFKA_BROKERS`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD`, `CONFIG_EXPORT_OW_API_HOST`, `CONFIG_EXPORT_OW_AUTH_TOKEN`, `CONFIG_EXPORT_S3_ENDPOINT`, `CONFIG_EXPORT_S3_ACCESS_KEY_ID`, `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY`, `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS` (default 8000), `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (default 10MB), `CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED` (default `console.config.export.completed`), `CONFIG_EXPORT_DEPLOYMENT_PROFILE` (default `standard`), `CONFIG_EXPORT_OW_ENABLED` (default `false`), `CONFIG_EXPORT_MONGO_ENABLED` (default `false`)
- **Optional components**: OpenWhisk functions collector (`CONFIG_EXPORT_OW_ENABLED=false`), MongoDB collector (`CONFIG_EXPORT_MONGO_ENABLED=false`) — both return `not_available` when disabled

## Admin-Data Privilege Separation (094-admin-data-privilege-separation)

- Two privilege domains enforced at APISIX plugin level: `structural_admin` (resource lifecycle, config, schema, deployment) and `data_access` (read/write/query/delete application data).
- New PostgreSQL tables: `privilege_domain_assignments`, `privilege_domain_denials`, `privilege_domain_assignment_history`.
- Extension of `services/gateway-config/plugins/scope-enforcement.lua` (T03) to evaluate `privilege_domain` claim from JWT or `api_keys.privilege_domain`.
- New OpenWhisk actions: `privilege-domain-assign`, `privilege-domain-query`, `privilege-domain-audit-query`, `privilege-domain-event-recorder`, `api-key-domain-migration`.
- New console pages: `ConsolePrivilegeDomainPage.tsx`, `ConsolePrivilegeDomainAuditPage.tsx`.
- New Kafka topics: `console.security.privilege-domain-denied` (30d), `console.security.privilege-domain-assigned` (30d), `console.security.privilege-domain-revoked` (30d), `console.security.last-admin-guard-triggered` (30d).
- New env vars: `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS` (default 60), `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` (default false), `PRIVILEGE_DOMAIN_LAST_ADMIN_GUARD_ENABLED` (default true), `APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS` (default 14), `PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED`, `PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN`.
- Last-admin guard: `SELECT FOR UPDATE` in `privilege-domain-assign` prevents removing the last structural-admin from a workspace.
- Keycloak realm roles: `structural_admin_{workspaceId}` and `data_access_{workspaceId}`.
- Legacy API keys migrated by `api-key-domain-migration` action; ambiguous keys flagged as `pending_classification`.
- Feature flag `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false` allows log-only observation before hard enforcement.

## Webhook Engine

- New service: `services/webhook-engine` using Node.js ESM modules.
- New PostgreSQL tables: `webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts`.
- New Kafka topics: `console.webhook.subscription.created`, `console.webhook.subscription.updated`, `console.webhook.subscription.deleted`, `console.webhook.subscription.paused`, `console.webhook.subscription.resumed`, `console.webhook.secret.rotated`, `console.webhook.delivery.succeeded`, `console.webhook.delivery.permanently_failed`, `console.webhook.subscription.auto_disabled`.
- New env vars: `WEBHOOK_SIGNING_KEY`, `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE`, `WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE`, `WEBHOOK_MAX_RETRY_ATTEMPTS`, `WEBHOOK_BASE_BACKOFF_MS`, `WEBHOOK_MAX_BACKOFF_MS`, `WEBHOOK_CONNECTION_TIMEOUT_MS`, `WEBHOOK_RESPONSE_TIMEOUT_MS`, `WEBHOOK_MAX_PAYLOAD_BYTES`, `WEBHOOK_SECRET_GRACE_PERIOD_SECONDS`, `WEBHOOK_AUTO_DISABLE_THRESHOLD`, `WEBHOOK_DELIVERY_HISTORY_MAX_DAYS`.
- New OpenWhisk actions: `webhook-management`, `webhook-dispatcher`, `webhook-delivery-worker`, `webhook-retry-scheduler`.

## Retry Semantics & Manual Intervention

- Failure classification pattern: classify failures with `classifyByErrorCode(errorCode, operationType, mappingCache)` backed by PostgreSQL table `failure_code_mappings`, loaded into in-memory cache ordered by `priority`.
- Manual intervention pattern: persist fast query state in `async_operations.manual_intervention_required` and preserve lifecycle/audit detail in `manual_intervention_flags`.
- Retry override pattern: create superadmin override records with `INSERT ... WHERE NOT EXISTS` semantics and return `409 OVERRIDE_IN_PROGRESS` on concurrent requests.
- New environment variables: `FAILURE_CLASSIFICATION_CACHE_TTL_SECONDS`, `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES`, `RETRY_OVERRIDE_REQUIRES_JUSTIFICATION`.
- New Kafka topics: `console.async-operation.failure-classified` (30d), `console.async-operation.manual-intervention-required` (30d), `console.async-operation.retry-override` (30d), `console.async-operation.intervention-notification` (7d).
## Secure Secret Storage

- New Vault service in namespace `secret-store` with External Secrets Operator integration from `eso-system`.
- New `secret-audit-handler` sidecar publishes sanitized audit events to Kafka topic `console.secrets.audit` (90d retention target).
- New PostgreSQL table: `secret_metadata` for metadata-only inventory; never stores secret values.
- New env vars: `VAULT_ADDR`, `VAULT_NAMESPACE`, `VAULT_SKIP_VERIFY`, `SECRET_AUDIT_KAFKA_TOPIC`, `SECRET_AUDIT_KAFKA_BROKERS`, `VAULT_UNSEAL_METHOD`, `VAULT_INIT_SHARES`, `VAULT_INIT_THRESHOLD`.
- Vault KV path structure: `platform/`, `tenant/{tenantId}/`, `functions/`, `gateway/`, `iam/`.

## Secure Secret Rotation (092-secret-rotation-no-redeploy)

- New PostgreSQL tables: `secret_version_states`, `secret_consumer_registry`, `secret_propagation_events`, `secret_rotation_events`.
- Migration file: `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`.
- New OpenWhisk actions: `secret-rotation-initiate`, `secret-rotation-revoke`, `secret-rotation-expiry-sweep`, `secret-rotation-propagation-timeout-sweep`, `secret-consumer-ack`, `secret-rotation-consumer-status`.
- New Kafka topics: `console.secrets.rotation.initiated` (30d), `console.secrets.rotation.grace-started` (30d), `console.secrets.rotation.propagated` (30d), `console.secrets.rotation.grace-expired` (30d), `console.secrets.rotation.revoked` (90d), `console.secrets.consumer.reload-requested` (7d), `console.secrets.consumer.reload-confirmed` (30d), `console.secrets.consumer.reload-timeout` (30d).
- New env vars: `SECRET_ROTATION_MIN_GRACE_SECONDS`, `SECRET_ROTATION_MAX_GRACE_SECONDS`, `SECRET_ROTATION_DEFAULT_GRACE_SECONDS`, `RELOAD_ACK_TIMEOUT_SECONDS`, `SECRET_ROTATION_SWEEP_BATCH_SIZE`.
- New console pages: `ConsoleSecretsPage.tsx`, `ConsoleSecretRotationPage.tsx`.
- Max two valid versions per secret path enforced via `UNIQUE INDEX uq_secret_active_version`.
- Rotation is atomic: PostgreSQL TX committed before Vault write; rollback on Vault failure.
- Vault KV v2 used for native versioning; soft-delete on grace expiry and revocation.

## Scope Enforcement (093-scope-enforcement-blocking)

- New PostgreSQL tables: `scope_enforcement_denials`, `endpoint_scope_requirements`.
- New Kafka topics: `console.security.scope-denied` (30d), `console.security.plan-denied` (30d), `console.security.workspace-mismatch` (30d), `console.security.config-error` (7d).
- New APISIX plugin: `services/gateway-config/plugins/scope-enforcement.lua`.
- New OpenWhisk actions: `scope-enforcement-audit-query`, `scope-enforcement-event-recorder`.
- New console page: `ConsoleScopeEnforcementPage.tsx`.
- New env vars: `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS` (default 30), `SCOPE_ENFORCEMENT_REQUIREMENTS_CACHE_TTL_SECONDS` (default 60), `SCOPE_ENFORCEMENT_AUDIT_QUERY_MAX_DAYS` (default 30), `SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH`, `SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR`, `SCOPE_ENFORCEMENT_ENABLED` (default false).
- Enforcement model: APISIX plugin `access` phase denies before backend routing, emits Kafka audit events fire-and-forget, persists queryable denials in PostgreSQL, and fails closed when endpoint requirements are missing.
## Plan Entity & Tenant Plan Assignment (097-plan-entity-tenant-assignment)

- New PostgreSQL tables: `plans`, `tenant_plan_assignments`, `plan_audit_events`.
- Key constraints: case-insensitive unique plan slug index, partial unique current assignment index on tenant, forward-only lifecycle trigger, `updated_at` trigger on plans.
- New Kafka topics (30d defaults): `console.plan.created`, `console.plan.updated`, `console.plan.lifecycle_transitioned`, `console.plan.assignment.created`, `console.plan.assignment.superseded`.
- New env vars: `PLAN_KAFKA_TOPIC_CREATED`, `PLAN_KAFKA_TOPIC_UPDATED`, `PLAN_KAFKA_TOPIC_LIFECYCLE`, `PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED`, `PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED`, `PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS`.
- New OpenWhisk actions: `plan-create`, `plan-update`, `plan-lifecycle`, `plan-list`, `plan-get`, `plan-assign`, `plan-assignment-get`, `plan-assignment-history`.
- Scope/quota enforcement remains out of scope for this slice and is deferred to follow-on tasks.

## Plan Base Limits (098-plan-base-limits)

- New PostgreSQL table: `quota_dimension_catalog` with 8 initial seeded dimensions.
- `plans.quota_dimensions` semantics are formalized: absent key = inherit catalog default, `0` = explicit zero, positive integer = explicit bounded limit, `-1` = unlimited.
- New `plan_audit_events.action_type` values: `plan.limit.set`, `plan.limit.removed`.
- New Kafka topic: `console.plan.limit_updated` (30d retention target).
- New OpenWhisk actions: `quota-dimension-catalog-list`, `plan-limits-set`, `plan-limits-remove`, `plan-limits-profile-get`, `plan-limits-tenant-get`.
- New env vars: `PLAN_LIMITS_KAFKA_TOPIC_UPDATED` (default `console.plan.limit_updated`), `PLAN_LIMITS_LOCK_TIMEOUT_MS` (default `5000`).
- Unlimited sentinel behavior: `-1` means unlimited, `0` means explicitly zero, missing key inherits the platform default from the catalog.


## Plan Management API & Console (099-plan-management-api-console)

- New APISIX route file: `services/gateway-config/routes/plan-management-routes.yaml` covering `/v1/plans`, `/v1/quota-dimensions`, `/v1/tenants/{tenantId}/plan*`, and `/v1/tenant/plan*`.
- Public platform OpenAPI family now describes the plan-management REST surface and tenant-owner self-service plan routes.
- New console pages: `ConsolePlanCatalogPage.tsx`, `ConsolePlanCreatePage.tsx`, `ConsolePlanDetailPage.tsx`, `ConsoleTenantPlanPage.tsx`, `ConsoleTenantPlanOverviewPage.tsx`.
- New shared console components: `PlanStatusBadge`, `PlanCapabilityBadge`, `PlanLimitsTable`, `PlanComparisonView`, `PlanAssignmentDialog`, `PlanHistoryTable`.
- New web-console API service: `apps/web-console/src/services/planManagementApi.ts`.
- Tenant-owner sessions are redirected toward `/console/my-plan` when attempting superadmin-only plan routes.

## Hard & Soft Quotas with Superadmin Override (103-hard-soft-quota-overrides)

- `plans.quota_type_config` añade clasificación por dimensión (`hard`/`soft`) y `graceMargin` por plan.
- Nuevas tablas PostgreSQL: `quota_overrides` y `quota_enforcement_log`.
- Nuevas acciones OpenWhisk: `quota-override-create`, `quota-override-modify`, `quota-override-revoke`, `quota-override-list`, `quota-effective-limits-get`, `quota-override-expiry-sweep`, `quota-enforce`, `quota-audit-query`.
- Nuevos topics Kafka: `console.quota.override.created`, `console.quota.override.modified`, `console.quota.override.revoked`, `console.quota.override.expired`, `console.quota.hard_limit.blocked`, `console.quota.soft_limit.exceeded`.
- Nuevas env vars: `QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED`, `QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED`, `QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED`, `QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED`, `QUOTA_ENFORCEMENT_KAFKA_TOPIC_HARD_BLOCKED`, `QUOTA_ENFORCEMENT_KAFKA_TOPIC_SOFT_EXCEEDED`, `QUOTA_OVERRIDE_EXPIRY_SWEEP_BATCH_SIZE`, `QUOTA_OVERRIDE_JUSTIFICATION_MAX_LENGTH`.
- Regla operativa: jerarquía efectiva `override > plan > catalog default`; soft quota permite gracia hasta `effectiveLimit + graceMargin`; `-1` mantiene el sentinel de ilimitado.
- Restricción de implementación para este branch: durante `speckit.implement`, leer de forma dirigida solo `plan.md`, `tasks.md` y el File Path Map de la feature; no abrir el OpenAPI completo.

## Plan Boolean Capabilities (104-plan-boolean-capabilities)

- New PostgreSQL table: `boolean_capability_catalog` (governed catalog of boolean platform features per plan).
- Existing column `plans.capabilities JSONB` (from 097) is now validated against `boolean_capability_catalog` on all writes.
- New OpenWhisk actions: `capability-catalog-list`, `plan-capability-set`, `plan-capability-profile-get`, `tenant-effective-capabilities-get`, `plan-capability-audit-query`.
- New Kafka topics: `console.plan.capability.enabled` (30d), `console.plan.capability.disabled` (30d).
- New env vars: `CAPABILITY_KAFKA_TOPIC_ENABLED` (default `console.plan.capability.enabled`), `CAPABILITY_KAFKA_TOPIC_DISABLED` (default `console.plan.capability.disabled`).
- Initial catalog seed: 7 capabilities — `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions` — all defaulting to `false`.
- Capability enforcement (blocking access at gateway/UI) deferred to US-PLAN-02-T05.
- `effective-entitlements-repository.mjs` enhanced: `toCapabilityList` now resolves display labels from catalog and includes all catalog capabilities (not just explicitly-set ones); backward-compatible fallback when table absent.
- New `plan_audit_events.action_type` values: `plan.capability.enabled`, `plan.capability.disabled`.

## Effective Limit Resolution (105-effective-limit-resolution)

- New PostgreSQL table: `workspace_sub_quotas` with unique constraint `(tenant_id, workspace_id, dimension_key)`, FK to `quota_dimension_catalog(dimension_key)`, and `allocated_value >= 0`.
- New OpenWhisk actions: `tenant-effective-entitlements-get`, `workspace-sub-quota-set`, `workspace-sub-quota-remove`, `workspace-sub-quota-list`, `workspace-effective-limits-get`.
- New Kafka topics: `console.quota.sub_quota.set`, `console.quota.sub_quota.removed`, `console.quota.sub_quota.inconsistency_detected`.
- New env vars: `SUB_QUOTA_KAFKA_TOPIC_SET`, `SUB_QUOTA_KAFKA_TOPIC_REMOVED`, `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY`, `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS`.
- Resolution hierarchy: tenant `override > plan > catalog_default`; workspace `workspace_sub_quota > tenant_shared_pool`.
- Workspace sub-quotas are finite-only: `-1` remains the tenant unlimited sentinel and is invalid at workspace sub-quota level.
- Implement-read constraints for this slice: targeted file reads only, no full OpenAPI read, and only `plan.md` + `tasks.md` as spec context during `speckit.implement`.
- Preserve unrelated untracked artifacts: `specs/070-saga-compensation-workflows/plan.md`, `specs/070-saga-compensation-workflows/tasks.md`, `specs/072-workflow-e2e-compensation/tasks.md`.

## Consumption Visibility Console (106-consumption-visibility-console)

- T04 is a read-only layer on top of T01–T03 data. No new PostgreSQL tables introduced.
- New OpenWhisk actions: `tenant-consumption-snapshot-get`, `workspace-consumption-get`, `tenant-workspace-allocation-summary-get`.
- `tenant-effective-entitlements-get` extended with `?include=consumption` query param (backwards compatible).
- `consumption-repository.mjs` provides the dimension-to-table query registry with parallel execution and per-dimension graceful degradation.
- New APISIX routes: 5 new consumption routes added to `plan-management-routes.yaml`.
- New console components: `ConsumptionBar`, `QuotaConsumptionTable`, `CapabilityStatusGrid`, `OverrideIndicatorBadge`, `WorkspaceAllocationSummaryTable`.
- New console pages: `ConsoleWorkspaceDashboardPage`, `ConsoleTenantAllocationSummaryPage`; extended: `ConsoleTenantPlanOverviewPage`, `ConsoleTenantPlanPage`.
- `planManagementApi.ts` extended with `ConsumptionSnapshot`, `WorkspaceConsumptionResponse`, `AllocationSummary` types and 3 new fetch functions.
- Progress bar thresholds: `< 80%` = green, `80–99%` = amber, `≥ 100%` = red; unlimited (`-1`) suppresses bar.
- Consumption unavailability degrades per-dimension to `usageStatus: 'unknown'`; row is never hidden (FR-018).
- No Kafka events emitted; pure read path.
- Implement-read constraints: targeted file reads only, no full control-plane OpenAPI reads, family OpenAPI only, no broad browsing.

## Functional Config Export (115-functional-config-export)

- Task: US-BKP-02-T01 — Export functional configuration (IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, OpenWhisk functions, S3 buckets/policies) as a structured JSON artifact.
- Architecture: collector-per-domain model with `Promise.allSettled` orchestration; partial degradation (one failing collector does not abort export).
- New PostgreSQL table: `config_export_audit_log` (metadata-only audit; artifact NOT stored in DB — returned directly as HTTP response body).
- New OpenWhisk actions: `tenant-config-export` (main orchestrator), `tenant-config-export-domains` (auxiliary: lists exportable domains by deployment profile).
- New collectors under `services/provisioning-orchestrator/src/collectors/`: `iam-collector.mjs`, `postgres-collector.mjs`, `mongo-collector.mjs`, `kafka-collector.mjs`, `functions-collector.mjs`, `s3-collector.mjs`, `registry.mjs`, `types.mjs`.
- New Kafka topic: `console.config.export.completed` (90-day retention).
- New console page: `ConsoleTenantConfigExportPage.tsx` with `ConfigExportDomainSelector` and `ConfigExportResultPanel` components.
- New API routes: `POST /v1/admin/tenants/{tenant_id}/config/export`, `GET /v1/admin/tenants/{tenant_id}/config/export/domains`.
- Domain status values: `ok`, `empty`, `error`, `not_available`, `not_requested`.
- Artifact format_version: `"1.0"` (formal versioning deferred to US-BKP-02-T02).
- Secret redaction: explicit field allowlists per collector + heuristic pattern matching in `types.mjs`; placeholder `"***REDACTED***"`.
- Optional components: `CONFIG_EXPORT_OW_ENABLED=false` and `CONFIG_EXPORT_MONGO_ENABLED=false` by default; return `not_available` when disabled.
- New env vars (19): `CONFIG_EXPORT_KEYCLOAK_ADMIN_URL`, `CONFIG_EXPORT_KEYCLOAK_REALM`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_ID`, `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET`, `CONFIG_EXPORT_PG_DATABASE_URL`, `CONFIG_EXPORT_MONGO_URI`, `CONFIG_EXPORT_MONGO_ENABLED`, `CONFIG_EXPORT_KAFKA_BROKERS`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME`, `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD`, `CONFIG_EXPORT_OW_API_HOST`, `CONFIG_EXPORT_OW_AUTH_TOKEN`, `CONFIG_EXPORT_OW_ENABLED`, `CONFIG_EXPORT_S3_ENDPOINT`, `CONFIG_EXPORT_S3_ACCESS_KEY_ID`, `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY`, `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS` (default 8000), `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (default 10485760), `CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED` (default `console.config.export.completed`), `CONFIG_EXPORT_DEPLOYMENT_PROFILE` (default `standard`).
- HTTP responses: `200` full export, `207` partial, `403` insufficient role, `404` tenant not found, `422` artifact too large, `429` rate limit.
- Authorized roles: `superadmin`, `sre`, `service_account` with scope `platform:admin:config:export`. Tenant owners are NOT permitted.

### US-BKP-02-T02: Versioned export/import format

- **New modules**: `services/provisioning-orchestrator/src/schemas/` (JSON Schema registry, v1.0.0 schema, lightweight validator, migration infrastructure).
- **New actions**: `tenant-config-validate.mjs` (POST validate artifact), `tenant-config-migrate.mjs` (POST migrate artifact), `tenant-config-format-versions.mjs` (GET supported format versions).
- **New events module**: `events/config-schema-events.mjs` — Kafka `console.config.schema.validated` and `console.config.schema.migrated`.
- **Modified export action**: `tenant-config-export.mjs` — `format_version` changed from `'1.0'` to `'1.0.0'` (semver), added `schema_checksum` field.
- **New APISIX routes**: `config-validate-post`, `config-migrate-post`, `config-format-versions-get` in `backup-admin-routes.yaml`.
- **Console layer**: `apps/web-console/src/api/configSchemaApi.ts` (types + fetch), `apps/web-console/src/components/ConfigArtifactValidator.tsx` (validation/migration panel).
- **New env vars**: `CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED` (default `console.config.schema.validated`), `CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED` (default `console.config.schema.migrated`), `CONFIG_SCHEMA_MAX_INPUT_BYTES` (default `10485760`).
- **New Kafka topics**: `console.config.schema.validated` (30d retention), `console.config.schema.migrated` (30d retention).
- Authorization: same scope `platform:admin:config:export` as export endpoints. Roles: `superadmin`, `sre`, `service_account`.

## Config vs Data Restore Differences (120-config-vs-data-restore-differences)

- **New file**: `docs/operations/config-vs-data-restore-differences.md` — operational reference documenting the distinction between configuration restoration (US-BKP-02-T01 to T05) and user data restoration (not covered by the current chain), domain by domain (IAM/Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible).
- **Coverage**: six domains × three aspects each (restorable config, non-restorable data, complementary mechanism).
- **Transversal limitations documented**: redacted secrets, dynamic/emergent config, config-data coherence risk, cross-domain non-transactionality, optional domains.
- **Audiences**: SRE/platform team (full document), superadmin (executive summary + table), product team (gap status column), QA/audit (traceability section).
- **Gap status for all domains**: `no_cubierto` — no integrated platform mechanism for user data backup exists; external/native subsystem tools are documented as complementary mechanisms.
- **No runtime dependencies**: documentation-only artifact; no code, migrations, API routes, or Kafka topics added.

<!-- MANUAL ADDITIONS END -->
