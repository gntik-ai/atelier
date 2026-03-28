# Observability Quota Policies

This document records the canonical quota-policy and posture baseline introduced by `US-OBS-03-T02`.
It builds directly on the usage-consumption contract from `US-OBS-03-T01` and establishes the shared
threshold semantics that later alerting, blocking, console, and verification work must reuse.

This increment does **not** emit alerts, block resource creation, or deliver the final console
experience. It defines the authoritative policy and posture layer those downstream tasks depend on.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-quota-policies.json` is the source of truth for:

- tenant and workspace quota-posture scopes,
- threshold types and ordering rules,
- supported posture states,
- metered-dimension coverage inherited from usage consumption,
- audit-compatible evaluation metadata,
- and the published public-route / permission mapping.

## Why quota policy is a distinct baseline

`US-OBS-03-T01` answered an important question:

**How much is a tenant or workspace consuming across all metered dimensions?**

That still left a second question unresolved:

**How should the platform interpret that measured usage against warning, soft, and hard quota
thresholds in a consistent way?**

`US-OBS-03-T02` answers that with one bounded contract and helper surface so later tasks do not
re-encode threshold logic independently.

## Threshold semantics in scope

The current baseline supports three threshold types per metered dimension:

- `warning_threshold`
- `soft_limit`
- `hard_limit`

The comparison rule is deliberately simple and stable:

- equality at a threshold is inclusive,
- threshold ordering must remain monotonic,
- and hard-limit posture is stronger than soft-limit posture, which is stronger than warning posture.

Validation rejects contradictory policies such as:

- negative thresholds,
- `warning_threshold > soft_limit`,
- `soft_limit > hard_limit`,
- or `warning_threshold > hard_limit` when no soft limit exists.

## Supported posture states

The current baseline publishes these canonical posture states:

- `within_limit`
- `warning_threshold_reached`
- `soft_limit_exceeded`
- `hard_limit_reached`
- `evidence_degraded`
- `evidence_unavailable`
- `unbounded`

Important interpretation rules:

- `hard_limit_reached` is the strongest posture and is the signal later enforcement work will
  consume.
- `soft_limit_exceeded` indicates overage posture without forcing hard blocking in this increment.
- `warning_threshold_reached` indicates that the scope is approaching constraint and should be
  surfaced by later consumers.
- `evidence_degraded` and `evidence_unavailable` preserve the quality of the underlying telemetry so
  posture never appears more trustworthy than its usage evidence.
- `unbounded` keeps a dimension visible when no enforced threshold exists for it.

## Scope and isolation rules

The quota-posture surface supports only:

- `tenant`
- `workspace`

The current route surface is:

- `GET /v1/metrics/tenants/{tenantId}/quotas`
- `GET /v1/metrics/workspaces/{workspaceId}/quotas`

Important isolation rules:

- tenant posture requires `tenantId` and must not widen to workspace scope,
- workspace posture requires both `tenantId` and `workspaceId`,
- workspace responses must not leak cross-workspace or cross-tenant posture,
- and every published route must align with the authorization model's quota-read actions.

## Relationship to usage freshness

Quota posture does not replace or hide the freshness semantics from the usage baseline.

The evaluator inherits the usage dimension freshness states from `US-OBS-03-T01`:

- `fresh`
- `degraded`
- `unavailable`

That means operators can distinguish two different questions:

1. what posture the thresholds imply,
2. and how trustworthy the underlying usage evidence is.

The baseline keeps both visible in the dimension posture output.

## Audit compatibility

Each quota posture evaluation remains aligned to the canonical audit-event vocabulary:

- subsystem: `quota_metering`
- action category: `configuration_change`
- origin surface: `scheduled_operation`

The evaluation audit payload is intentionally bounded to posture metadata such as:

- evaluation id,
- scope,
- overall posture,
- hard/soft/warning dimension ids,
- and evaluation timestamp.

It must not embed secrets, raw request payloads, or cross-tenant detail.

## Relationship to the remaining `US-OBS-03` tasks

`US-OBS-03-T02` is the policy and posture baseline only.

Downstream work remains separate:

- `US-OBS-03-T03` — alert/event emission on threshold breach
- `US-OBS-03-T04` — hard-limit blocking of create/provision flows
- `US-OBS-03-T05` — console usage vs quota view and provisioning state
- `US-OBS-03-T06` — end-to-end cross-module tests

Keeping these boundaries explicit prevents the policy baseline from absorbing runtime reactions or UI
work prematurely.

## Residual implementation note

This baseline publishes the machine-readable quota-policy contract, shared helper readers,
deterministic validation, additive metrics-family routes, documentation, and tests required before
alerting, enforcement, and final operator visibility can expand safely.
