# ADR 073: Async job status model

- Status: Accepted
- Date: 2026-03-30

## Context

US-UIB-02-T01 introduces the foundational async operation lifecycle used by provisioning workflows and later console status endpoints.

## Decisions

1. `async_operation` is a first-class entity independent from `saga_instances`.
2. Lifecycle transitions are persisted in PostgreSQL via `async_operation_transitions` and Kafka is used for audit propagation.
3. `correlation_id` is propagated from caller context when present and otherwise generated as `op:{tenantId}:{ts_base36}:{random8}`.
4. Every state change publishes `async_operation.state_changed` to topic `console.async-operation.state-changed` keyed by `tenantId`.
5. OpenWhisk actions remain thin wrappers over reusable ESM domain/repository/event modules.

## Consequences

- Query and audit use cases can evolve without exposing saga internals.
- Tenant isolation is enforced at repository and action boundaries.
- Future tasks can layer HTTP/query surfaces and retries on top of the same persisted model.
