# Observability Hard-Limit Enforcement

This document records the bounded `US-OBS-03-T04` baseline that converts the observability quota
posture from `US-OBS-03-T01`/`T02` and the alert baseline from `US-OBS-03-T03` into a deterministic
hard-stop admission surface for resource-creation requests.

## Canonical denial contract

The machine-readable source of truth is:

- `services/internal-contracts/src/observability-hard-limit-enforcement.json`

Canonical hard-limit denials use:

- HTTP status `429`
- `error_code=QUOTA_HARD_LIMIT_REACHED`
- required fields:
  - `error_code`
  - `dimension_id`
  - `scope_type`
  - `scope_id`
  - `current_usage`
  - `hard_limit`
  - `blocking_action`
  - `retryable`
  - `message`

## Scope precedence

If both workspace and tenant scopes are exhausted for the same operation, the effective denial is
selected using the strictest breached scope. In practice:

1. workspace-scoped denials win over tenant-scoped denials for workspace create/admission flows,
2. otherwise the most constrained breached scope is returned,
3. missing quota evidence fails closed.

## Supported dimensions and aliases

The contract preserves the backlog vocabulary used by `US-OBS-03`:

- `api_requests`
- `serverless_functions`
- `storage_buckets`
- `logical_databases`
- `kafka_topics`
- `collections_tables`
- `realtime_connections`
- `error_budget`

These dimension ids are intentionally additive aliases over the existing T01/T02 measurement
contracts so the earlier baselines do not need to be rewritten.

## Current create/admission mappings

The T04 baseline documents and/or enriches the following bounded surfaces:

- storage bucket admission preview
- OpenWhisk function create
- Kafka topic create
- PostgreSQL database / role / user / schema / table create
- MongoDB database / collection create

Each adapter preserves its existing native validation strings while exposing additive structured
`quotaDecision` metadata aligned to the shared enforcement contract.

## Audit posture

Every hard-limit evaluation can emit deterministic evidence via the shared audit contract:

- `eventType=quota.hard_limit.evaluated`
- `decision=allowed|denied`
- tenant/workspace scope,
- dimension id,
- blocking action,
- current usage,
- hard limit,
- evaluation timestamp.

## Policy refresh and hot reload

The enforcement helper evaluates explicit usage/limit inputs per request. No global decision cache is
required, so policy updates can propagate without service restarts.

## Public API documentation

Only the family OpenAPI inputs are updated during implementation:

- `apps/control-plane/openapi/families/storage.openapi.json`
- `apps/control-plane/openapi/families/functions.openapi.json`
- `apps/control-plane/openapi/families/events.openapi.json`
- `apps/control-plane/openapi/families/postgres.openapi.json`
- `apps/control-plane/openapi/families/mongo.openapi.json`

The aggregate public API is regenerated afterward with `npm run generate:public-api`.

## Validation

Primary validation entry point:

```bash
npm run validate:observability-hard-limit-enforcement
```

## Downstream boundary

This task deliberately stops short of:

- `US-OBS-03-T05` console usage vs quota presentation and provisioning-state UX
- `US-OBS-03-T06` broad cross-module end-to-end consumption/enforcement test coverage

Those increments remain separate to keep `T04` focused on the enforcement contract, helper surface,
adapter metadata, public denial docs, and bounded verification.
