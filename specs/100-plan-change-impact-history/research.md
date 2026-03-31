# Research — 100-plan-change-impact-history

## Decision 1: Persist history in dedicated immutable tables

- **Decision**: Use dedicated PostgreSQL tables for plan change history headers and per-dimension/per-capability snapshot rows.
- **Rationale**: The feature requires stable pagination, actor/date filtering, immutable historical accuracy, and efficient rendering of unchanged items. Dedicated tables are more queryable than embedding snapshots inside `tenant_plan_assignments` or `plan_audit_events` JSON blobs.
- **Alternatives considered**:
  - Store snapshot in `tenant_plan_assignments.assignment_metadata` — rejected because it mixes current assignment state with immutable history concerns.
  - Store snapshot only in `plan_audit_events` JSON — rejected because filters, pagination, and stable rendering would be expensive and brittle.

## Decision 2: Write history inside the existing assignment transaction

- **Decision**: Extend the `plan-assign` transaction so the assignment swap and history insert commit atomically.
- **Rationale**: This guarantees that only successful plan changes produce history and prevents duplicate entries during retries or concurrent updates.
- **Alternatives considered**:
  - Async post-commit history creation — rejected because it risks gaps/duplicates and weakens the SC-001 guarantee.

## Decision 3: Snapshot final resolved entitlements, not just references

- **Decision**: Persist the effective quota values and capability states that actually applied at change time, after resolving plan defaults and supported tenant adjustments.
- **Rationale**: Historical reads must remain accurate even if plan definitions or platform defaults change later.
- **Alternatives considered**:
  - Recompute on read from current plan/default tables — rejected because it breaks immutability and FR-009.

## Decision 4: Collect observed usage synchronously with best-effort per dimension

- **Decision**: During plan change processing, query authoritative usage sources per dimension and record either an observed usage value or explicit `unknown` metadata.
- **Rationale**: The snapshot must reflect posture at change time, but the spec allows missing usage for some dimensions.
- **Alternatives considered**:
  - Enrich usage asynchronously after commit — rejected because the resulting snapshot would no longer represent the actual time of change.
  - Fail the whole plan change if any usage source is unavailable — rejected because the feature is informational and the spec permits `unknown`.

## Decision 5: Canonicalize unlimited and inherited values before comparison

- **Decision**: Normalize values to semantic kinds (`bounded`, `unlimited`, `missing`) before computing `increased`, `decreased`, `added`, `removed`, and `unchanged`.
- **Rationale**: Numeric comparison alone is unsafe when `-1` means unlimited and missing means inherit catalog default.
- **Alternatives considered**:
  - Raw integer comparison — rejected because it misrepresents unlimited semantics.

## Decision 6: Expose current entitlement summary via a dedicated action

- **Decision**: Add a `plan-effective-entitlements-get` read action for tenant-owner and superadmin consumers.
- **Rationale**: The “current summary” should reflect current effective entitlements, not merely the last history record, while still linking back to the latest plan-change event.
- **Alternatives considered**:
  - Read only the last snapshot — rejected because future override mechanisms could make the last snapshot stale for current-state reads.

## Decision 7: Observability must be first-class and privacy-aware

- **Decision**: Emit structured logs, metrics, and a Kafka audit event keyed by history entry id/correlation id; avoid logging full snapshot payloads or sensitive free-text notes.
- **Rationale**: The task explicitly calls for telemetry, dashboards, correlation, masking, and observable success criteria.
- **Alternatives considered**:
  - Log entire payloads for convenience — rejected because of cardinality and privacy risk.

## Decision 8: Keep downgrade handling informational only

- **Decision**: Mark over-limit conditions in the snapshot and UI but do not block assignment, auto-remediate, or enforce overage policy.
- **Rationale**: This is directly aligned with FR-016 and the out-of-scope statements.
- **Alternatives considered**:
  - Block downgrades when usage exceeds new limits — rejected because that belongs to later policy work.
