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

## Scope delivered in `US-OBS-02-T04`

This increment establishes the **bounded audit export and sensitive-data masking baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-export-surface.json` as the machine-readable source of truth for tenant/workspace audit export scopes, supported formats, masking profiles, sensitive-field rules, response metadata, and console export settings
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit export-surface contract
- `scripts/lib/observability-audit-export-surface.mjs` and `scripts/validate-observability-audit-export-surface.mjs` for deterministic validation of the export/masking surface and its alignment with the pipeline, schema, query surface, authorization, and public API baselines
- `apps/control-plane/openapi/control-plane.openapi.json` additive tenant/workspace audit-export routes under the metrics family plus generated route-catalog and family-doc refreshes
- `apps/control-plane/src/observability-audit-export.mjs` and `apps/web-console/src/observability-audit-export.mjs` helpers that normalize scope-safe audit export requests and apply deterministic masking metadata from the shared contract
- `docs/reference/architecture/observability-audit-export-surface.md` as the human-readable architecture guide for the audit export/masking baseline
- `docs/reference/architecture/README.md` index updates so the new export guidance is discoverable

## Main decisions in `US-OBS-02-T04`

### Audit export reuses the T03 filter vocabulary

The export surface does not invent a second filter language.
It reuses the same bounded filter set already defined for query/consultation so export and on-screen review stay aligned.

### Export is permissioned separately from plain audit read access

The authorization model now introduces:

- `tenant.audit.export`
- `workspace.audit.export`

This keeps evidence packaging narrower than plain read visibility.

### Protected audit detail fields are always masked in exported evidence

The export surface derives protected-field coverage from the audit pipeline masking baseline and currently masks:

- `password`
- `secret`
- `token`
- `authorization_header`
- `connection_string`
- `raw_hostname`
- `raw_endpoint`
- `object_key`
- `raw_topic_name`

Exported records now declare whether masking was applied and which field refs were masked.

### Correlation and end-to-end verification remain explicitly deferred

This increment only defines export/masking behavior.
It does **not** implement:

- cross-system causal correlation (`US-OBS-02-T05`)
- durable export distribution or replay workflows
- end-to-end traceability and data-protection verification (`US-OBS-02-T06`)

## Validation for `US-OBS-02-T04`

Primary validation entry point:

```bash
npm run validate:observability-audit-export-surface
```

## Downstream dependency note for `US-OBS-02-T04`

This increment defines the bounded evidence-export layer that later traceability work can extend.

Downstream work remains:

- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Scope delivered in `US-OBS-02-T05`

This increment establishes the **bounded audit correlation and traceability baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-correlation-surface.json` as the machine-readable source of truth for tenant/workspace audit correlation scopes, trace statuses, timeline phases, downstream source contracts, masking compatibility, response metadata, and console trace settings
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit correlation-surface contract
- `scripts/lib/observability-audit-correlation-surface.mjs` and `scripts/validate-observability-audit-correlation-surface.mjs` for deterministic validation of the correlation surface and its alignment with the schema, query, export, authorization, internal-service-map, and public API baselines
- `apps/control-plane/openapi/control-plane.openapi.json` additive tenant/workspace audit-correlation routes under the metrics family plus generated route-catalog and family-doc refreshes
- `apps/control-plane/src/observability-audit-correlation.mjs` and `apps/web-console/src/observability-audit-correlation.mjs` helpers that normalize scope-safe audit correlation requests, derive bounded trace statuses, reuse T04 masking for correlated records, and expose console trace metadata from the shared contract
- `docs/reference/architecture/observability-audit-correlation-surface.md` as the human-readable architecture guide for the audit correlation baseline
- `docs/reference/architecture/README.md` index updates so the new correlation guidance is discoverable

## Main decisions in `US-OBS-02-T05`

### Console-originated actions now have one explicit traceability surface

The platform now defines one bounded correlation surface for:

- `/v1/metrics/tenants/{tenantId}/audit-correlations/{correlationId}`
- `/v1/metrics/workspaces/{workspaceId}/audit-correlations/{correlationId}`

This turns isolated audit records into one operationally useful end-to-end trace model.

### Traceability uses bounded statuses and phases instead of implicit investigator logic

The correlation contract now fixes the initial trace statuses to:

- `complete`
- `partial`
- `broken`
- `not_found`

It also fixes the initial phase vocabulary to:

- `console_initiation`
- `control_plane_execution`
- `downstream_system_effect`
- `audit_persistence`

This keeps API and console behavior aligned before T06 verification lands.

### Correlation is permissioned separately from plain audit consultation

The authorization model now introduces:

- `tenant.audit.correlate`
- `workspace.audit.correlate`

This keeps deeper end-to-end traceability narrower than plain audit read access.

### T04 masking semantics are reused instead of reinvented

The correlation surface reuses the existing export masking baseline for correlated audit-record projections and safe evidence pointers so protected values remain protected during investigations.

### End-to-end verification remains explicitly deferred

This increment only defines correlation and traceability behavior.
It does **not** implement:

- end-to-end traceability verification and data-protection proof (`US-OBS-02-T06`)
- incident case-management workflows
- replay or remediation automation

## Validation for `US-OBS-02-T05`

Primary validation entry point:

```bash
npm run validate:observability-audit-correlation-surface
```

## Downstream dependency note for `US-OBS-02-T05`

This increment defines the bounded correlation layer that later verification work can test.

Downstream work remains:

- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Scope delivered in `US-OBS-02-T06`

This increment establishes the **end-to-end audit traceability and sensitive-data protection verification baseline** for the platform.

Delivered artifacts:

- `tests/reference/audit-traceability-matrix.yaml` as the machine-readable source of truth for the verification categories, RF coverage, and T01–T05 contract-surface mappings
- `scripts/lib/audit-traceability.mjs` as the deterministic reader/alignment helper for the traceability matrix and its contract dependencies
- `tests/unit/observability-audit-traceability.test.mjs` for focused invariant coverage around matrix alignment, masking consistency, scope rejection, and bounded `not_found` handling
- `tests/e2e/observability/audit-traceability.test.mjs` for executable verification of full-chain traceability, masking consistency, tenant/workspace isolation, permission boundaries, and trace-state diagnostics
- `tests/reference/README.md`, `tests/e2e/README.md`, and `docs/reference/architecture/README.md` updates so the verification baseline is discoverable from the existing testing and architecture indexes

## Main decisions in `US-OBS-02-T06`

### One executable matrix now anchors the whole audit assurance slice

The platform now defines one machine-readable verification matrix that links:

- the T01 pipeline baseline
- the T02 canonical audit envelope
- the T03 consultation surface
- the T04 export + masking surface
- the T05 correlation surface

This closes the previous assurance gap where each increment had local validation but no bounded end-to-end verification baseline.

### Consultation, export, and correlation now share one masking expectation

The verification baseline checks the same protected fields through all three audit access paths so sensitive values stay masked consistently instead of relying on per-surface assumptions.

### Trace-state diagnostics are now regression-testable

The verification suite now exercises the four declared correlation states:

- `complete`
- `partial`
- `broken`
- `not_found`

This makes missing-link diagnostics and bounded not-found behavior part of the standard repository test flow.

### The increment stays verification-only

This increment does **not** add:

- new audit routes
- new contract JSON files
- new masking categories
- new emitters or downstream integrations
- case-management or remediation workflows

## Validation for `US-OBS-02-T06`

Primary validation entry points:

```bash
node --test tests/unit/observability-audit-traceability.test.mjs
node --test tests/e2e/observability/audit-traceability.test.mjs
```

Repository-level confirmation:

```bash
npm run lint
npm test
```

## Residual note for `US-OBS-02-T06`

This increment proves the current T01–T05 audit chain behavior through bounded executable verification.
If future work changes masking, permissions, or correlation semantics, the matrix and tests must be updated deliberately rather than relying on implicit behavior drift.
