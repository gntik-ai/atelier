# US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación

## Scope delivered in `US-OBS-02-T01`

This increment establishes the **common audit pipeline contract baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-pipeline.json` as the machine-readable source of truth for subsystem enrollment, event-category coverage, Kafka transport topology, at-least-once delivery, tenant isolation, resilience rules, health signals, and pipeline self-audit requirements
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit pipeline contract
- `scripts/lib/observability-audit-pipeline.mjs` and `scripts/validate-observability-audit-pipeline.mjs` for deterministic validation of the contract and its alignment with the existing observability baseline
- `docs/reference/architecture/observability-audit-pipeline.md` as the human-readable architecture guide for the audit pipeline baseline
- `docs/reference/architecture/README.md` index updates so the new audit guidance is discoverable

## Main decisions in `US-OBS-02-T01`

### One common audit pipeline precedes downstream audit features

The platform now defines one shared audit pipeline contract for administrative events emitted by:

- IAM (Keycloak)
- PostgreSQL
- MongoDB
- Kafka
- OpenWhisk
- S3-compatible storage
- the quota and metering layer
- the tenant and workspace control plane

This common baseline must be consumed by later work instead of letting each downstream task infer its own subsystem coverage or delivery guarantees.

### Kafka is the transport backbone and delivery is at least once

The contract explicitly fixes the audit path as:

```text
subsystem emitter → Kafka audit transport → durable audit store
```

The baseline also fixes tenant partitioning, platform-scoped routing, and the expectation that downstream consumers remain idempotent under at-least-once delivery.

### Audit health is part of observability, not a side concern

The audit pipeline defines required health signals for:

- emission freshness
- transport health
- storage health

These signals reuse the established observability label model and health vocabulary from `US-OBS-01` so missing or delayed audit coverage becomes operationally visible.

### Tenant isolation is enforced by the pipeline contract itself

Tenant-scoped audit events require `tenant_id`, may include `workspace_id` when safely attributable, and must never leak into other-tenant or platform-only views.

Platform-scoped events and unattributed events remain explicitly separate from tenant partitions.

## Validation for `US-OBS-02-T01`

Primary validation entry point:

```bash
npm run validate:observability-audit-pipeline
```

## Downstream dependency note

`US-OBS-02-T01` is the foundation for the remaining tasks in this story.

Later increments must build on this contract rather than redefining the pipeline:

- `US-OBS-02-T02` — detailed audit event schema
- `US-OBS-02-T03` — query and filter surfaces
- `US-OBS-02-T04` — export, masking, and sensitive-event handling
- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Scope delivered in `US-OBS-02-T02`

This increment establishes the **canonical audit event schema baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-event-schema.json` as the machine-readable source of truth for the canonical event envelope, including actor, scope, resource, action, result, correlation, origin, and bounded detail-extension rules
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit event schema contract
- `scripts/lib/observability-audit-event-schema.mjs` and `scripts/validate-observability-audit-event-schema.mjs` for deterministic validation of the schema and its alignment with the audit-pipeline and authorization-model baselines
- `docs/reference/architecture/observability-audit-event-schema.md` as the human-readable architecture guide for the canonical event schema baseline
- `docs/reference/architecture/README.md` index updates so the new schema guidance is discoverable

## Main decisions in `US-OBS-02-T02`

### One canonical audit envelope now exists for every subsystem

Every administrative audit record must now share the same top-level structure:

- `event_id`
- `event_timestamp`
- `actor`
- `scope`
- `resource`
- `action`
- `result`
- `correlation_id`
- `origin`
- `detail`

This prevents downstream tasks from inventing subsystem-specific audit envelopes.

### Scope and origin are standardized before query and correlation work

The schema explicitly normalizes:

- tenant/workspace/platform scope modes
- actor identity requirements
- action categories aligned to the T01 pipeline contract
- bounded result outcomes
- origin surfaces for control API, console backend, reconciler, provider-adapter, bootstrap, and scheduled flows

This gives later query, export, masking, and correlation work a stable contract to consume.

### `detail` is reserved for subsystem-specific fields without weakening the envelope

Subsystems may attach extra context under `detail`, but they may not move or redefine the canonical envelope fields there.

That keeps the common audit surface stable while still allowing future subsystem-specific enrichment.

## Validation for `US-OBS-02-T02`

Primary validation entry point:

```bash
npm run validate:observability-audit-event-schema
```

## Downstream dependency note for `US-OBS-02-T02`

This increment does **not** add query/filter APIs, export formats, masking execution, or correlation workflows.

Those remain downstream work:

- `US-OBS-02-T03` — query and filter surfaces
- `US-OBS-02-T04` — export, masking, and sensitive-event handling
- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Residual implementation note

This increment does **not** implement runtime emitters, Kafka topic provisioning, consumers,
storage adapters, query APIs, export logic, masking execution, or correlation behavior.
It only establishes the bounded contract, validation, and documentation foundation required before
those later tasks can proceed safely.

## Scope delivered in `US-OBS-02-T03`

This increment establishes the **canonical audit query and filter surface baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-query-surface.json` as the machine-readable source of truth for tenant/workspace audit query scopes, supported filters, pagination policy, response metadata, and console explorer settings
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit query-surface contract
- `scripts/lib/observability-audit-query-surface.mjs` and `scripts/validate-observability-audit-query-surface.mjs` for deterministic validation of the query/filter surface and its alignment with the pipeline, schema, authorization, and public API baselines
- `apps/control-plane/openapi/control-plane.openapi.json` additive tenant/workspace audit-record query routes under the metrics family plus generated route-catalog and family-doc refreshes
- `apps/control-plane/src/observability-audit-query.mjs` and `apps/web-console/src/observability-audit.mjs` helpers that normalize scope-safe audit queries and expose console-facing explorer metadata from the shared contract
- `docs/reference/architecture/observability-audit-query-surface.md` as the human-readable architecture guide for the audit query/filter baseline
- `docs/reference/architecture/README.md` index updates so the new query guidance is discoverable

## Main decisions in `US-OBS-02-T03`

### Audit consultation is exposed first at tenant and workspace scope

The initial audit read surface stays bounded to:

- `/v1/metrics/tenants/{tenantId}/audit-records`
- `/v1/metrics/workspaces/{workspaceId}/audit-records`

This delivers real consultation value without widening the scope to a cross-tenant platform query surface.

### API and console share one filter vocabulary

Both API and console consumers now reuse the same declared filters for:

- time range
- subsystem
- action category and action id
- outcome
- actor type and actor id
- resource type and resource id
- origin surface
- correlation id

That prevents drift between backend and console behavior before export/masking work lands.

### Workspace audit consultation now uses an explicit permission

The authorization model now introduces `workspace.audit.read` so workspace-scoped audit consultation does not have to overload unrelated read permissions.

### Export, masking, and correlation remain explicitly deferred

This increment only defines query/filter consultation behavior.
It does **not** implement:

- export/download flows (`US-OBS-02-T04`)
- masking/sensitive-event handling (`US-OBS-02-T04`)
- cross-system correlation execution (`US-OBS-02-T05`)
- end-to-end traceability verification (`US-OBS-02-T06`)

## Validation for `US-OBS-02-T03`

Primary validation entry point:

```bash
npm run validate:observability-audit-query-surface
```

## Downstream dependency note for `US-OBS-02-T03`

This increment defines the bounded consultation surface required before later work can extend it.

Downstream work remains:

- `US-OBS-02-T04` — export, masking, and sensitive-event handling
- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing
