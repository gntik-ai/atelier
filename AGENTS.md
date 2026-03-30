# atelier Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies
- Node.js 20+ (ESM modules), aligned with existing project standard (072-workflow-e2e-compensation)
- PostgreSQL (relational workflow/audit data), MongoDB (document state) (072-workflow-e2e-compensation)
- Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets + Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules (001-function-versioning-rollback)
- PostgreSQL access via `pg`, Kafka publication via `kafkajs`, OpenWhisk action wrappers for async operation lifecycle (073-async-job-status-model)
- Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrapper patterns establecidos en T01/T02 (075-idempotent-retry-dedup)
- PostgreSQL (idempotency_key_records, retry_attempts + extensión de async_operations), Kafka (eventos auditables) (075-idempotent-retry-dedup)

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
- 075-idempotent-retry-dedup: Added Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrappers establecidos en T01/T02
- 074-async-job-progress-ui: Added async operation query endpoints/contracts, log-entry migration, console operation tracking pages, and focused backend/frontend tests
- 073-async-job-status-model: Added async operation domain model, PostgreSQL persistence, Kafka event contract, and OpenWhisk action wrappers

## Async Operation Idempotency & Retry

- New PostgreSQL entities: `idempotency_key_records` (tenant-scoped dedup ledger) and `retry_attempts` (attempt history for failed async operations)
- `async_operations` now tracks `attempt_count` and optional `max_retries`
- New OpenWhisk action: `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs`
- Existing create action now supports idempotency-key deduplication with `X-Idempotent-Replayed` and `X-Idempotent-Params-Mismatch` response headers
- New Kafka audit topics: `console.async-operation.deduplicated` and `console.async-operation.retry-requested`
- New environment variables: `IDEMPOTENCY_KEY_TTL_HOURS`, `OPERATION_DEFAULT_MAX_RETRIES`, `IDEMPOTENCY_KEY_MAX_LENGTH`

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
