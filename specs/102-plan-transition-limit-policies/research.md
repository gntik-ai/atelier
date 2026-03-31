# Research: Plan Transition & Limit Excess Policies

## Scope

This document captures the Phase 0 decisions for feature `102-plan-transition-limit-policies`. It is derived from `plan.md` and exists to make the later implementation step deterministic.

## Decision 1: Policy resolution order

**Decision**: Resolve excess policy in this order:

1. dimension-level override
2. transition-level override
3. platform default
4. built-in fallback (`grace_period`, 14 days)

**Rationale**:
- Gives operators a safe default for the whole platform.
- Allows a specific plan pair to override platform behavior.
- Allows a specific quota dimension to override both when business rules require stricter handling.
- Produces deterministic, explainable results.

**Rejected alternative**: a two-layer model (`transition` + `platform default`) was rejected because some dimensions need stricter treatment regardless of plan pair.

## Decision 2: Grace period escalation mechanism

**Decision**: Expire active grace periods through an application-level sweep action (`grace-period-sweep.mjs`) invoked by an OpenWhisk alarm trigger every 10 minutes.

**Rationale**:
- Matches the existing application-layer lifecycle pattern used by other sweeps.
- Keeps state transitions auditable in application code.
- Avoids coupling the feature to PostgreSQL extensions.

**Operational target**: records must be escalated no later than 15 minutes after `expires_at`.

**Rejected alternative**: `pg_cron` was rejected because lifecycle logic must remain portable and visible in the service layer.

## Decision 3: Consumption data sourcing

**Decision**: Reuse the consumption collector abstraction introduced in feature 100 and read observed usage per dimension from the same source used for quota impact history.

**Rationale**:
- Prevents duplicated usage collection logic.
- Keeps policy enforcement aligned with the impact-history model.
- Allows the transition audit trail to store the same observed usage numbers used in impact analysis.

**Fallback behavior**:
- If usage data is unavailable for a dimension, mark the evaluation as `deferred`.
- Missing usage data must not block a transition by itself unless a stricter rule is explicitly applied elsewhere.

## Decision 4: Concurrent transition guard

**Decision**: Enforce one in-flight transition per tenant with a database-level partial unique index on `tenant_transitions_in_progress(tenant_id) WHERE completed_at IS NULL`.

**Rationale**:
- Declarative and durable across multiple OpenWhisk instances.
- Consistent with existing uniqueness patterns already used in the codebase.
- Avoids session-scoped or infrastructure-specific locking.

**Rejected alternatives**:
- PostgreSQL advisory locks: rejected because they are session-scoped and less explicit.
- Redis locks: rejected because Redis is not part of the established stack for this feature.

## Decision 5: Transition direction classification

**Decision**: Compute transition direction dynamically from source and target plan capabilities and effective quota dimensions.

**Classification rules**:
- `upgrade`: all relevant limits are equal or higher and capabilities are a superset.
- `downgrade`: at least one limit decreases or a capability is removed.
- `lateral`: neither side strictly dominates.
- `initial_assignment`: no source plan exists.
- `equivalent`: source and target are the same plan.

**Rationale**:
- Avoids storing redundant directional metadata on rules.
- Keeps the result correct if plans are edited later.
- Makes the evaluator authoritative for both compatibility and excess-policy flow.

**Rejected alternative**: manually assigned direction on the rule itself was rejected because it can drift from live plan data.

## Decision 6: Wildcard syntax for transition rules

**Decision**:
- `source_plan_id = NULL` means “any source plan”.
- `target_plan_id = NULL` means “any target plan”.

**Match precedence**:
1. exact source + exact target
2. exact source + wildcard target
3. wildcard source + exact target
4. wildcard source + wildcard target
5. tie-breaker: newest row wins (`created_at DESC`)

**Rationale**:
- Simple storage model.
- Index-friendly lookup behavior.
- No custom pattern syntax to validate or explain.

**Rejected alternative**: string-based wildcard or glob syntax was rejected as unnecessarily complex for the supported use cases.

## Sentinel handling agreed for design

| Source | Target | Interpretation |
|---|---|---|
| `-1` | positive integer | unlimited to finite, evaluate excess against the target |
| positive integer | `-1` | finite to unlimited, no excess possible |
| any | `0` | zero limit, any usage above zero is over-limit |
| absent | explicit value | resolve inherited/default effective source value before comparison |
| missing dimension in source | dimension exists in target | use catalog default for source effective value |

## Implementation implications

- No existing resources are deleted or disabled during plan change.
- Only creation rights may be restricted after downgrade.
- Every transition attempt must produce a queryable audit record.
- Blocked transitions must fail before assignment mutation.
- Upgrade paths must bypass excess evaluation entirely.
