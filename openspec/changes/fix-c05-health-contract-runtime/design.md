## Context

`packages/internal-contracts/src/observability-health-checks.json` defines liveness, readiness, health, and six internal aggregate/component exposures. The control-plane listener currently wires only legacy probes, so contractual routes are unreachable. C-11's `schemaReadiness` addition to `/readyz` remains compatible and is retained.

## Design

Health route registration occurs during control-plane server construction. A process liveness builder has no PostgreSQL dependency. Readiness and aggregate builders consume injected adapters for `control_plane`, PostgreSQL, and each declared component. Adapter calls are bounded by per-check timeouts and may use a short, explicitly documented cache; cache age is surfaced as `stale`. Missing or failing adapters produce stable, sanitized `unknown`/`stale` component evidence and never a fabricated healthy/ready result. Aggregate status follows the contract's canonical precedence (unhealthy/error before stale, stale before unknown, unknown before healthy; readiness additionally requires every required dependency healthy).

Every response validates against the checked-in contract, includes a generated or propagated correlation ID, and avoids secrets, raw errors, hostnames, or unbounded payloads. Legacy routes remain aliases with their established status semantics plus C-11 fields. Internal routes are registered on the internal listener only and are absent from APISIX routes and SPA clients; protection relies on deployment topology/network reachability, not invented mTLS.

Deployment probe configuration and Docker packaging reference the same contract/source-of-truth. Rollback is safe because legacy endpoints remain available and route registration is additive; adapters fail closed to observable unknown/stale evidence. Audit access is read-only, bounded, and correlation-scoped, with no datastore writes. Existing metrics are reused without new families or labels (C-07 is out of scope).
