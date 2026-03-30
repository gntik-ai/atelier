# atelier Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies
- Node.js 20+ (ESM modules), aligned with existing project standard (072-workflow-e2e-compensation)
- PostgreSQL (relational workflow/audit data), MongoDB (document state) (072-workflow-e2e-compensation)
- Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets + Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules (001-function-versioning-rollback)
- PostgreSQL access via `pg`, Kafka publication via `kafkajs`, OpenWhisk action wrappers for async operation lifecycle (073-async-job-status-model)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrapper patterns establecidos en T01/T02 (075-idempotent-retry-dedup)
- PostgreSQL (idempotency_key_records, retry_attempts + extensión de async_operations), Kafka (eventos auditables) (075-idempotent-retry-dedup)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (existing `services/provisioning-orchestrator`), React 18 + Tailwind CSS + shadcn/ui (console) (089-api-key-rotation)
- PostgreSQL (rotation state, policy, history), Keycloak (credential lifecycle), APISIX (gateway consumer key verification) (089-api-key-rotation)

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
- 089-api-key-rotation: Added Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka), Apache OpenWhisk action patterns (existing `services/provisioning-orchestrator`), React 18 + Tailwind CSS + shadcn/ui (console)
- 075-idempotent-retry-dedup: Added Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrappers establecidos en T01/T02
- 074-async-job-progress-ui: Added async operation query endpoints/contracts, log-entry migration, console operation tracking pages, and focused backend/frontend tests

## Async Operation Idempotency & Retry

- New PostgreSQL entities: `idempotency_key_records` (tenant-scoped dedup ledger) and `retry_attempts` (attempt history for failed async operations)
- `async_operations` now tracks `attempt_count` and optional `max_retries`
- New OpenWhisk action: `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs`
- Existing create action now supports idempotency-key deduplication with `X-Idempotent-Replayed` and `X-Idempotent-Params-Mismatch` response headers
- New Kafka audit topics: `console.async-operation.deduplicated` and `console.async-operation.retry-requested`
- New environment variables: `IDEMPOTENCY_KEY_TTL_HOURS`, `OPERATION_DEFAULT_MAX_RETRIES`, `IDEMPOTENCY_KEY_MAX_LENGTH`

<!-- MANUAL ADDITIONS START -->
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
<!-- MANUAL ADDITIONS END -->
