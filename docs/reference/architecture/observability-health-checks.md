# Observability Health Checks

This document records the canonical health-check baseline introduced by `US-OBS-01-T03`.
It defines how the platform expresses `liveness`, `readiness`, and broader `health` for APISIX,
Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane while reusing the normalized
observability plane established by `US-OBS-01-T01` and the dashboard hierarchy established by
`US-OBS-01-T02`.

This increment does **not** implement a public health API, console UI, alert routing workflow, or
smoke-test suite. It defines the internal operational contract that future work must consume.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-health-checks.json` is the source of truth for:

- canonical probe semantics,
- aggregate and per-component operational exposure templates,
- redaction and audit requirements,
- component-specific dependency metadata,
- and probe projection into the observability plane.

## Why there are three probe classes

The platform uses three probe classes on purpose.

### Liveness

Liveness answers a narrow question: **is the runtime alive enough to avoid dead-process restart
loops?**

A dependency outage alone should not automatically make liveness fail. Otherwise the platform could
restart components that are still alive but temporarily dependency-blocked.

### Readiness

Readiness answers a different question: **can this component safely serve or participate in the
platform right now?**

A component may remain live while becoming not ready because a dependency is unavailable,
consistency is not yet established, or the service must stay out of traffic during a rollout or
maintenance window.

### Health

Health is broader than both liveness and readiness.

Health communicates operational posture such as:

- healthy,
- degraded,
- unavailable,
- unknown,
- stale,
- or inherited.

This lets operators distinguish degraded-but-serving states from completely unavailable states.

## Operational exposure model

The health baseline defines two kinds of internal exposure.

### Aggregate platform probes

These are the internal rollups used by orchestration and platform operations:

- `/internal/live`
- `/internal/ready`
- `/internal/health`

They summarize the current required-component posture for the platform.

### Per-component probes

These are the internal component-specific inspection surfaces:

- `/internal/live/components/{componentId}`
- `/internal/ready/components/{componentId}`
- `/internal/health/components/{componentId}`

They are internal/platform-only templates, not public API guarantees.

## Required components

The baseline covers exactly these seven subsystem ids:

- `apisix`
- `kafka`
- `postgresql`
- `mongodb`
- `openwhisk`
- `storage`
- `control_plane`

That list must remain aligned with the unified observability metrics-stack contract.

## Masking and traceability

Health data is operationally sensitive.

The baseline therefore requires:

- actor-aware access,
- correlation-aware access,
- component and probe-type traceability,
- masking of secrets and raw infrastructure coordinates,
- and conservative fallback to inherited or masked summaries when narrower scope detail is not
  safely attributable.

Forbidden exposed detail includes examples such as passwords, tokens, authorization headers, raw
connection strings, raw hostnames, raw endpoints, object keys, and raw broker topic names.

## Projection into the observability plane

`US-OBS-01-T03` adds additive normalized probe metric families so health outcomes can be queried in
the same observability plane:

- `in_falcone_component_probe_status`
- `in_falcone_component_probe_duration_seconds`
- `in_falcone_component_probe_failures_total`

These families remain internal observability primitives and must use the existing label discipline,
including `environment`, `subsystem`, `metric_scope`, `collection_mode`, `probe_type`, and
`exposure_kind`.

## Alignment with dashboard semantics

The health baseline is intentionally compatible with the dashboard baseline from
`US-OBS-01-T02`.

That means:

- dashboards may summarize probe outcomes,
- dashboards must not redefine what the probes mean,
- stale probe evidence cannot be shown as healthy current posture,
- tenant/workspace views must preserve the same conservative inherited-degradation behavior,
- and unsupported workspace precision must remain explicit rather than inferred.

## Notes for downstream observability work

- `US-OBS-01-T04` should keep business metrics separate from this technical health baseline.
- `US-OBS-01-T05` should reuse these probe semantics when presenting internal console summaries or
  alert-oriented health rollups.
- `US-OBS-01-T06` should validate the actual runtime/smoke behavior against this contract rather
  than inventing alternate probe meanings.

## Residual implementation note

This baseline defines the machine-readable contract, helper surfaces, validation rules, and
architecture guidance for health checks. It does not claim that every component's runtime handler,
operator path, or orchestration wiring is already implemented in this repository.
