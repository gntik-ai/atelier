# ADR 093: Scope enforcement blocking in the gateway

- Status: Accepted
- Date: 2026-03-31

## Context

Need to block out-of-scope token and membership usage before requests reach backend services, while preserving an audit trail for denied requests.

## Decision

Use an APISIX Lua plugin in the `access` phase with an LRU cache for endpoint requirements and a PostgreSQL-backed audit/query surface.

## Alternatives considered

- OPA sidecar: rejected due to extra network round-trip and higher operational complexity.
- External auth service: rejected due to additional SPOF and latency overhead.

## Consequences

- Target p95 enforcement remains below 5 ms on cache hit paths.
- Plan entitlement changes may take up to 30 seconds to propagate due to cache TTL.
- Missing route declarations fail closed and emit auditable `CONFIG_ERROR` records.
