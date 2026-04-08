# Implementation Plan: Plan Transition & Limit Excess Policies

**Branch**: `102-plan-transition-limit-policies` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/102-plan-transition-limit-policies/spec.md`  
**Task ID**: US-PLAN-01-T06 | **Epic**: EP-19 | **Story**: US-PLAN-01

## Summary

This plan documents the policies, data model, contracts, and enforcement logic for plan transition compatibility and limit excess handling in the multi-tenant BaaS platform. It builds on the foundations laid by 097 (plan entity), 098 (base limits), 099 (plan management API), 100 (change impact history), and 101 (upgrade/downgrade tests). The feature introduces a three-tier policy resolution hierarchy (dimension-level > transition-level > platform default), explicit transition compatibility rules, three limit excess policy modes (`grace-period`, `block-creation`, `block-transition`), automatic grace period expiration sweeps, and full audit trails for every policy evaluation. No new resources are ever deleted or disabled on plan change; only creation rights are gated.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka audit events), `undici` (integration tests), existing OpenWhisk action patterns from 097–101  
**Storage**: PostgreSQL (transition rules, excess policy config, grace period records, over-limit conditions, policy audit); optional consumption reads from existing collectors (MongoDB/PostgreSQL/service APIs as in 100)  
**Testing**: `node:test` + `node:assert` (unit); `undici` (integration); existing fixtures pattern from 101  
**Target Platform**: Linux server / Kubernetes + OpenShift via Helm  
**Project Type**: Backend service additions (new OpenWhisk actions + PostgreSQL migrations + APISIX policy enforcement hooks + console pages)  
**Performance Goals**: Every plan transition attempt produces a complete, queryable audit record within 5 seconds (SC-001)  
**Constraints**: p95 policy evaluation < 500 ms at the action layer; grace period expiration sweep ≤ 15 min past expiry (SC-004); no partial state mutation on blocked transitions (SC-005)  
**Scale/Scope**: Multi-tenant, potentially thousands of tenants; consumption data sourced from existing collectors introduced in 100

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| I. Monorepo Separation of Concerns | New actions under `services/provisioning-orchestrator/src/actions/`, migrations under `src/migrations/`, console pages under `apps/web-console/src/pages/`, no new top-level folders | ✅ PASS |
| II. Incremental Delivery First | Documentation-first task; spec and plan precede any code; all artifacts are forward-compatible with existing 097–101 tables | ✅ PASS |
| III. Kubernetes/OpenShift Compatibility | No new deployment units; new env vars added to existing Helm values; no OpenShift-incompatible primitives introduced | ✅ PASS |
| IV. Quality Gates at the Root | New integration tests extend root-level `pnpm test` entry point via existing patterns | ✅ PASS |
| V. Documentation as Part of the Change | This plan.md, data-model.md, contracts/, and research.md constitute the documentation; ADR not required as no new top-level folder is created | ✅ PASS |

**Verdict**: No gate violations. Ready to proceed.

## Project Structure

### Documentation (this feature)

```text
specs/102-plan-transition-limit-policies/
├── plan.md              # This file (speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── transition-rule-api.json
│   ├── excess-policy-api.json
│   ├── grace-period-api.json
│   ├── policy-evaluation-api.json
│   └── kafka-events.json
└── tasks.md             # Phase 2 output (speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/src/
├── migrations/
│   └── 102-plan-transition-policies.sql          # DDL for new tables
├── models/
│   ├── transitionCompatibilityRule.mjs
│   ├── limitExcessPolicy.mjs
│   ├── gracePeriodRecord.mjs
│   └── overLimitCondition.mjs
├── repositories/
│   ├── transitionCompatibilityRuleRepository.mjs
│   ├── limitExcessPolicyRepository.mjs
│   └── gracePeriodRepository.mjs
├── services/
│   ├── transitionPolicyEvaluator.mjs             # Core policy resolution engine
│   ├── excessConditionDetector.mjs               # Per-dimension excess evaluation
│   └── gracePeriodSweepService.mjs               # Expiry escalation sweep
├── actions/
│   ├── transition-rule-create.mjs
│   ├── transition-rule-list.mjs
│   ├── transition-rule-delete.mjs
│   ├── excess-policy-set.mjs
│   ├── excess-policy-get.mjs
│   ├── excess-policy-evaluate.mjs                # Hypothetical dry-run endpoint
│   ├── grace-period-list.mjs
│   ├── grace-period-sweep.mjs                    # Called by cron trigger
│   └── over-limit-status-get.mjs                 # Tenant-owner self-service
└── events/
    └── transitionPolicyEventEmitter.mjs

apps/web-console/src/
├── pages/
│   ├── ConsolePlanTransitionRulesPage.tsx         # Superadmin: rule catalog
│   ├── ConsolePlanExcessPolicyPage.tsx            # Superadmin: policy config
│   └── ConsoleTenantOverLimitStatusPage.tsx       # Tenant-owner: over-limit view
└── components/
    ├── TransitionRuleTable.tsx
    ├── ExcessPolicyBadge.tsx
    ├── GracePeriodCountdown.tsx
    └── OverLimitDimensionList.tsx

services/gateway-config/routes/
└── plan-transition-policy-routes.yaml             # New APISIX routes

tests/
└── integration/
    └── 102-plan-transition-policies/
        ├── transition-rule-enforcement.test.mjs
        ├── limit-excess-grace-period.test.mjs
        ├── limit-excess-block-creation.test.mjs
        ├── limit-excess-block-transition.test.mjs
        ├── grace-period-expiry-sweep.test.mjs
        ├── policy-resolution-hierarchy.test.mjs
        ├── concurrent-transition-guard.test.mjs
        └── upgrade-clean-path.test.mjs
```

**Structure Decision**: Extends the existing `services/provisioning-orchestrator` monorepo service (established in 097–101). No new project roots. Console additions follow the React 18 + Tailwind CSS + shadcn/ui pattern from 099. Deployment uses existing Helm chart values; new env vars appended to existing `values.yaml`.

## Phase 0: Research

### Resolved Decisions

**Decision 1: Policy resolution order**  
*Decision*: Dimension-level override > transition-specific override > platform-wide default (three tiers, first match wins, most specific tier wins).  
*Rationale*: Mirrors standard ACL/policy layering patterns; allows product ops to set sensible platform defaults while overriding exceptional transitions or dimensions without touching unrelated config.  
*Alternatives considered*: Two-tier (plan-pair + default) — rejected because dimension-level granularity is required by FR-006 (e.g., storage always block-creation regardless of transition direction).

**Decision 2: Grace period escalation mechanism**  
*Decision*: Periodic sweep action (`grace-period-sweep.mjs`) called by OpenWhisk alarm trigger every 10 minutes. Detects records where `expires_at < NOW()` and `status = active`, transitions them to `block-creation`, emits Kafka audit event. SC-004 target: ≤ 15 min past expiry.  
*Rationale*: Aligns with existing `secret-rotation-expiry-sweep` and `retry_attempts` sweep patterns already in the codebase. OpenWhisk alarm triggers are the established cron mechanism.  
*Alternatives considered*: PostgreSQL `pg_cron` extension — rejected because the project mandates application-layer lifecycle logic in OpenWhisk actions for auditability and portability.

**Decision 3: Consumption data for excess detection**  
*Decision*: Reuse the consumption collector abstraction introduced in 100 (`QuotaImpactLineItem.observedUsage`). At transition time, call existing usage collector per dimension, record observed values in the `over_limit_conditions` table. If data unavailable, mark `evaluation_status = deferred` and re-evaluate when data is next available.  
*Rationale*: Avoids duplicating usage collection logic. 100 already defines `usageCollectionStatus` enum. Consistent model across impact history and policy enforcement.  
*Alternatives considered*: Synchronous real-time usage query at transition time — remains the primary path, deferred status is fallback only.

**Decision 4: Concurrent transition guard**  
*Decision*: Enforce at the database layer: a partial unique index on `tenant_plan_transitions_in_progress(tenant_id) WHERE completed_at IS NULL`. Insert-on-conflict returns `409 TRANSITION_IN_PROGRESS`. PostgreSQL advisory locks are not used (non-portable, session-scoped).  
*Rationale*: Consistent with the `uq_tenant_plan_assignments_current` pattern from 097. Declarative at the DB level means the guard survives across distributed OpenWhisk instances.  
*Alternatives considered*: Redis-based lock — rejected because Redis is not in the established stack.

**Decision 5: Transition direction classification**  
*Decision*: Direction is computed at evaluation time by comparing source and target plan `quota_dimensions` and `capabilities` from 097/098. Rule: if all dimensions are ≥ and capabilities are a superset → `upgrade`; if any dimension strictly decreases or capability is removed → `downgrade`; if neither strictly dominates → `lateral`; no prior plan → `initial_assignment`; same plan → `equivalent`.  
*Rationale*: Avoids storing a redundant direction field on the transition rule. Direction is derived from the live plan data so it stays accurate if plans are mutated (e.g., admin edits limits after rules are created).  
*Alternatives considered*: Explicit admin-set direction on rule — available as an optional classifier override but not the authoritative source.

**Decision 6: Wildcard syntax for transition rules**  
*Decision*: `source_plan_id = NULL` means "any source"; `target_plan_id = NULL` means "any target". Rules are matched in precedence order: exact source + exact target > exact source + wildcard target > wildcard source + exact target > wildcard + wildcard. Ties broken by `created_at DESC` (most recently created rule wins).  
*Rationale*: Simple to store in PostgreSQL. NULL-based wildcards are unambiguous and index-friendly.  
*Alternatives considered*: String-based glob patterns — rejected as overly complex for the limited wildcard cases needed.

## Phase 1: Design

### Data Model

*(See `data-model.md` for full DDL. Summary below.)*

#### New Tables

**`plan_transition_compatibility_rules`**

```sql
CREATE TABLE plan_transition_compatibility_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id    UUID REFERENCES plans(id) NULL,  -- NULL = wildcard
  target_plan_id    UUID REFERENCES plans(id) NULL,  -- NULL = wildcard
  disposition       VARCHAR(32) NOT NULL CHECK (disposition IN ('allowed', 'allowed_with_approval', 'blocked')),
  justification     TEXT NULL,
  created_by        VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes: `idx_tcr_source_target`, `idx_tcr_target`, partial null indexes for wildcard lookups.

**`plan_excess_policy_config`**

```sql
CREATE TABLE plan_excess_policy_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type        VARCHAR(32) NOT NULL CHECK (scope_type IN ('platform_default', 'transition', 'dimension')),
  source_plan_id    UUID REFERENCES plans(id) NULL,  -- for 'transition' scope
  target_plan_id    UUID REFERENCES plans(id) NULL,  -- for 'transition' scope
  dimension_key     VARCHAR(64) REFERENCES quota_dimension_catalog(dimension_key) NULL,  -- for 'dimension' scope
  policy_mode       VARCHAR(32) NOT NULL CHECK (policy_mode IN ('grace_period', 'block_creation', 'block_transition')),
  grace_period_days INT NULL CHECK (grace_period_days > 0),  -- required when policy_mode = 'grace_period'
  created_by        VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_grace_days_required CHECK (
    (policy_mode = 'grace_period' AND grace_period_days IS NOT NULL) OR
    (policy_mode != 'grace_period')
  )
);
```

Unique: one platform_default record, one per (source, target) for transition scope, one per (dimension_key) for dimension scope.

**`tenant_grace_period_records`**

```sql
CREATE TABLE tenant_grace_period_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR(255) NOT NULL,
  dimension_key        VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
  transition_id        UUID NOT NULL REFERENCES plan_transition_audit_events(id),
  effective_limit      BIGINT NOT NULL,
  observed_consumption BIGINT NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'expired_escalated', 'resolved')),
  resolved_at          TIMESTAMPTZ NULL,
  escalated_at         TIMESTAMPTZ NULL
);
```

Index: `idx_tgpr_tenant_dimension_active` on `(tenant_id, dimension_key) WHERE status = 'active'`.  
Partial unique: `uq_tgpr_tenant_dimension_active` on `(tenant_id, dimension_key) WHERE status = 'active'` — one active grace period per tenant/dimension.

**`tenant_over_limit_conditions`**

```sql
CREATE TABLE tenant_over_limit_conditions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR(255) NOT NULL,
  dimension_key        VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
  transition_id        UUID NOT NULL REFERENCES plan_transition_audit_events(id),
  effective_limit      BIGINT NOT NULL,
  observed_consumption BIGINT NOT NULL,
  policy_mode          VARCHAR(32) NOT NULL,
  evaluation_status    VARCHAR(32) NOT NULL DEFAULT 'active'
                         CHECK (evaluation_status IN ('active', 'deferred', 'resolved')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Partial unique: `uq_tolc_tenant_dimension_active` on `(tenant_id, dimension_key) WHERE evaluation_status = 'active'`.

**`plan_transition_audit_events`**  
New table (distinct from `plan_audit_events` which tracks plan entity mutations). Each row is one complete policy evaluation for a transition attempt.

```sql
CREATE TABLE plan_transition_audit_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                VARCHAR(255) NOT NULL,
  source_plan_id           UUID REFERENCES plans(id) NULL,
  target_plan_id           UUID NOT NULL REFERENCES plans(id),
  actor_id                 VARCHAR(255) NOT NULL,
  correlation_id           VARCHAR(255) NULL,
  transition_direction     VARCHAR(32) NOT NULL,
  compatibility_rule_id    UUID REFERENCES plan_transition_compatibility_rules(id) NULL,
  rule_disposition         VARCHAR(32) NULL,
  final_outcome            VARCHAR(32) NOT NULL
                             CHECK (final_outcome IN ('allowed', 'allowed_with_approval', 'blocked_by_rule', 'blocked_by_excess', 'no_op')),
  over_limit_dimensions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_evaluation_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Index: `idx_ptae_tenant_created`, `idx_ptae_created`.

**`tenant_transitions_in_progress`** (concurrency guard)

```sql
CREATE TABLE tenant_transitions_in_progress (
  tenant_id    VARCHAR(255) NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX uq_ttip_tenant_active ON tenant_transitions_in_progress(tenant_id)
  WHERE completed_at IS NULL;
```

#### Modified Tables

- `plan_audit_events.action_type`: add values `transition.rule.created`, `transition.rule.deleted`, `excess.policy.set`, `excess.policy.deleted`, `grace_period.started`, `grace_period.expired_escalated`, `grace_period.resolved`, `over_limit.created`, `over_limit.resolved`.

#### Sentinel and special-case handling

| Source value | Target value | Excess evaluation |
|---|---|---|
| `-1` (unlimited) | positive integer | Evaluate consumption vs target |
| positive integer | `-1` (unlimited) | Clean — no excess possible |
| any | `0` | Treat as `0` limit; any usage > 0 is over-limit |
| absent (inherits default) | new value | Resolve source effective value first, then compare |
| dimension not in source plan | dimension in target plan | Treat source effective value as catalog default |

### Interface Contracts

*(Full OpenAPI/JSON schemas in `contracts/`. Summaries below.)*

#### REST API (via APISIX routes → OpenWhisk actions)

| Method | Path | Action | Scope |
|---|---|---|---|
| `POST` | `/v1/admin/plan-transition-rules` | `transition-rule-create` | superadmin |
| `GET` | `/v1/admin/plan-transition-rules` | `transition-rule-list` | superadmin |
| `DELETE` | `/v1/admin/plan-transition-rules/:id` | `transition-rule-delete` | superadmin |
| `PUT` | `/v1/admin/excess-policy` | `excess-policy-set` | superadmin |
| `GET` | `/v1/admin/excess-policy` | `excess-policy-get` | superadmin |
| `POST` | `/v1/admin/excess-policy/evaluate` | `excess-policy-evaluate` | superadmin (dry-run) |
| `GET` | `/v1/admin/tenants/:tenantId/grace-periods` | `grace-period-list` | superadmin |
| `GET` | `/v1/tenant/plan/over-limit-status` | `over-limit-status-get` | tenant-owner |

The `plan-assign` action (from 097, `plan-lifecycle` route) is **modified** to:
1. Insert into `tenant_transitions_in_progress` (conflict → 409).
2. Classify direction via `transitionPolicyEvaluator`.
3. Check compatibility rule → reject or require acknowledgment flag.
4. If `block-transition` excess condition detected → reject.
5. Commit assignment via existing 097 logic.
6. Insert over-limit conditions and grace periods if applicable.
7. Emit Kafka events.
8. Mark transition as complete.

#### Kafka Events

All events published to namespace-prefixed topics with 30-day retention.

| Topic | Trigger |
|---|---|
| `console.plan.transition.evaluated` | Every transition attempt (allowed, blocked, no-op) |
| `console.plan.transition.blocked` | Blocked by rule or excess |
| `console.plan.excess.detected` | Over-limit condition created |
| `console.plan.grace_period.started` | Grace period record created |
| `console.plan.grace_period.expired` | Sweep escalation fired |
| `console.plan.grace_period.resolved` | Tenant returned to compliance |
| `console.plan.creation.blocked` | Resource creation attempt blocked by over-limit |

Standard envelope (extends existing patterns from 097–100):

```json
{
  "eventType": "console.plan.transition.evaluated",
  "correlationId": "<uuid>",
  "actorId": "<actor>",
  "tenantId": "<tenantId>",
  "sourceplanId": "<uuid|null>",
  "targetPlanId": "<uuid>",
  "transitionDirection": "downgrade",
  "finalOutcome": "allowed",
  "overLimitDimensions": [
    {
      "dimensionKey": "max_workspaces",
      "effectiveLimit": 3,
      "observedConsumption": 7,
      "policyApplied": "grace_period",
      "policyLayer": "platform_default",
      "gracePeriodDays": 30,
      "expiresAt": "2026-04-30T00:00:00Z"
    }
  ],
  "timestamp": "<ISO8601>"
}
```

#### Resource creation enforcement hook

When a tenant attempts to create a resource of a type governed by a `block_creation` over-limit condition, the enforcement layer (APISIX scope plugin or action-layer guard) returns:

```json
{
  "error": "OVER_LIMIT_CREATION_BLOCKED",
  "message": "Your plan does not permit creating additional workspaces. Your current count (7) exceeds the plan limit (3). Remove 4 workspaces to restore creation rights.",
  "dimension": "max_workspaces",
  "currentUsage": 7,
  "effectiveLimit": 3,
  "policyMode": "block_creation"
}
```

### Policy Resolution Algorithm

```text
function resolveExcessPolicy(sourcePlanId, targetPlanId, dimensionKey):
  1. Lookup dimension-level override:
     SELECT * FROM plan_excess_policy_config
     WHERE scope_type = 'dimension' AND dimension_key = dimensionKey
     → If found, return this policy.

  2. Lookup transition-level override:
     SELECT * FROM plan_excess_policy_config
     WHERE scope_type = 'transition'
       AND source_plan_id = sourcePlanId
       AND target_plan_id = targetPlanId
     → If found, return this policy.

  3. Lookup platform default:
     SELECT * FROM plan_excess_policy_config
     WHERE scope_type = 'platform_default'
     → If found, return this policy.

  4. Fallback: return built-in default (grace_period, 14 days).
     Log warning: no platform default configured.
```

### Environment Variables

New env vars (added to `services/provisioning-orchestrator` Helm values):

| Variable | Default | Description |
|---|---|---|
| `TRANSITION_POLICY_DEFAULT_GRACE_DAYS` | `14` | Built-in fallback grace period if no config row exists |
| `TRANSITION_POLICY_DEFAULT_MODE` | `grace_period` | Built-in fallback mode if no config row exists |
| `TRANSITION_POLICY_FALLBACK_ON_MISSING_RULE` | `allow` | `allow` or `block` — governs transitions with no matching rule |
| `GRACE_PERIOD_SWEEP_BATCH_SIZE` | `50` | Max records processed per sweep invocation |
| `GRACE_PERIOD_SWEEP_KAFKA_TOPIC_EXPIRED` | `console.plan.grace_period.expired` | |
| `PLAN_TRANSITION_KAFKA_TOPIC_EVALUATED` | `console.plan.transition.evaluated` | |
| `PLAN_TRANSITION_KAFKA_TOPIC_BLOCKED` | `console.plan.transition.blocked` | |
| `PLAN_EXCESS_KAFKA_TOPIC_DETECTED` | `console.plan.excess.detected` | |
| `PLAN_CREATION_BLOCKED_KAFKA_TOPIC` | `console.plan.creation.blocked` | |

### Sequence: Plan Assignment with Policy Evaluation

```text
SuperAdmin → APISIX → plan-assign action
  1. Validate JWT scope (structural_admin)
  2. INSERT INTO tenant_transitions_in_progress
     → ON CONFLICT: return 409 TRANSITION_IN_PROGRESS
  3. Load source plan (current assignment) + target plan
  4. Classify transition direction (upgrade/downgrade/lateral/initial/equivalent)
     → If equivalent (same plan): no-op, UPDATE completed_at, return 200 NO_OP
  5. Check compatibility rule:
     a. Query plan_transition_compatibility_rules (exact + wildcard)
     b. If blocked: INSERT plan_transition_audit_events (blocked_by_rule)
        → UPDATE completed_at, return 422 TRANSITION_BLOCKED
     c. If allowed_with_approval: check acknowledgment flag in request body
        → If missing: return 422 APPROVAL_REQUIRED
  6. If upgrade (no dimension decreases): skip excess evaluation
     → Proceed to step 9 with no over-limit conditions
  7. Collect current consumption (reuse 100 collector abstraction, per dimension)
  8. For each decreasing dimension:
     a. resolveExcessPolicy(source, target, dimensionKey)
     b. If block_transition: add to blocked_dimensions list
  9. If any block_transition dimension: INSERT audit event (blocked_by_excess)
     → return 422 EXCESS_BLOCK_TRANSITION with details
  10. Within single DB transaction:
      a. Supersede current assignment (097 pattern)
      b. INSERT new tenant_plan_assignments row
      c. INSERT plan_transition_audit_events (allowed)
      d. For each grace_period dimension: INSERT tenant_grace_period_records
      e. For each block_creation / grace_period dimension:
         INSERT/UPSERT tenant_over_limit_conditions
      f. INSERT plan_change_history_entry (100 pattern)
  11. Publish Kafka events (fire-and-forget, outside transaction)
  12. UPDATE tenant_transitions_in_progress SET completed_at = NOW()
  13. Return 200 with full policy evaluation summary
```

## Testing Strategy

### Unit Tests

| Test | Target |
|---|---|
| Policy resolution hierarchy | `transitionPolicyEvaluator.mjs` — dimension > transition > default |
| Direction classification | all combinations: upgrade, downgrade, lateral, initial, equivalent, mixed |
| Unlimited-to-finite detection | `-1` source → positive target triggers excess evaluation |
| Finite-to-unlimited detection | any source → `-1` target is clean |
| Zero-limit detection | `0` target with any usage > 0 is over-limit |
| Same-plan no-op | identical source/target → no evaluation, no records |
| Wildcard rule matching precedence | exact-exact > exact-wildcard > wildcard-exact > wildcard-wildcard |

### Integration Tests

| Test file | Scenarios covered |
|---|---|
| `transition-rule-enforcement.test.mjs` | Create rules, test allowed/approval/blocked dispositions |
| `limit-excess-grace-period.test.mjs` | Downgrade with over-limit → grace period created, tenant retains resources |
| `limit-excess-block-creation.test.mjs` | block-creation policy → creation attempt blocked with correct error |
| `limit-excess-block-transition.test.mjs` | block-transition policy → assignment rejected before state mutation |
| `grace-period-expiry-sweep.test.mjs` | Grace period expires → escalated to block-creation, audit event emitted |
| `policy-resolution-hierarchy.test.mjs` | Dimension override beats transition override beats platform default |
| `concurrent-transition-guard.test.mjs` | Concurrent assignments for same tenant → 409 on second |
| `upgrade-clean-path.test.mjs` | Upgrade → no excess evaluation triggered, no over-limit records created |

### Contract Tests

- OpenAPI schemas in `contracts/` validated against live action responses using existing `@in-falcone/internal-contracts` validation patterns.
- Kafka event envelopes validated against `kafka-events.json` schema in contract tests.

### Operational Validation

- After migration: `SELECT COUNT(*) FROM plan_excess_policy_config` returns 0 (no default pre-configured) → fallback env vars apply.
- After first sweep run: no `tenant_grace_period_records` with `status = 'active'` and `expires_at < NOW()`.
- Audit trail completeness: every `plan_transition_audit_events` row has a non-null `final_outcome`.

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Consumption data unavailable at transition time | Medium | `deferred` status with re-evaluation; no transition blocked solely due to missing data unless `block-transition` policy requires it |
| Grace period sweep lag (>15 min) | Low | Alarm trigger every 10 min; SC-004 requires ≤15 min; alert on sweep duration metric |
| Partial state mutation if Kafka publish fails | Low | DB transaction commits first; Kafka is fire-and-forget; idempotent sweep corrects state |
| Active grace period conflict on re-downgrade | Medium | `uq_tgpr_tenant_dimension_active` prevents duplicate; more restrictive policy governs per spec edge case |
| Admin misconfigures block-transition as platform default, trapping tenants | Medium | Validation: warn if platform-default is `block-transition` (permitted but flagged in API response and console) |
| Rule wildcard ambiguity | Low | Explicit precedence algorithm (Decision 6); unit tested exhaustively |
| Performance: policy evaluation adds latency to plan-assign | Low | Policies are DB reads (small tables, indexed); grace period writes are in same transaction; target <500 ms at action layer |

## Migration Strategy

**Migration file**: `services/provisioning-orchestrator/src/migrations/102-plan-transition-policies.sql`

1. Create `plan_transition_compatibility_rules`
2. Create `plan_excess_policy_config`
3. Create `tenant_grace_period_records`
4. Create `tenant_over_limit_conditions`
5. Create `plan_transition_audit_events`
6. Create `tenant_transitions_in_progress`
7. Add new `action_type` values to `plan_audit_events` CHECK constraint (extend enum or widen constraint)

All DDL is additive. No existing table rows are modified. Safe to run against a live database without downtime (no locks on existing tables during CREATE TABLE statements).

**Rollback**: Drop the six new tables and revert the `plan_audit_events` CHECK constraint. The `plan-assign` action modifications gate on feature-flag env var `TRANSITION_POLICY_ENFORCEMENT_ENABLED` (default `false` for initial rollout). Feature flag allows progressive activation.

## Idempotency and Safety

- `tenant_transitions_in_progress` unique index: idempotent guard.
- Grace period records: partial unique index prevents duplicate active records per tenant/dimension.
- Over-limit conditions: upsert semantics; inserting the same condition twice is a no-op.
- Sweep action: processes only records with `status = 'active'` and `expires_at < NOW()`; already-escalated records are skipped.
- `plan-assign` action: if action is retried (e.g., OpenWhisk retry), completed transition in `tenant_transitions_in_progress` (non-null `completed_at`) is detected and the action returns the cached outcome without re-mutating state.

## Observability

- New structured log fields: `transitionDirection`, `finalOutcome`, `overLimitDimensionCount`, `policyLayer` on every `plan-assign` invocation.
- Kafka events enable downstream alerting (e.g., alert on sustained `blocked_by_rule` or `grace_period.expired` volume).
- `plan_transition_audit_events` is directly queryable by compliance and ops teams.
- Console pages surface over-limit conditions to tenant owners (SC-003).

## Security

- Transition rules and excess policy config: superadmin-only (`structural_admin` privilege domain from 094).
- `over-limit-status-get` action: tenant-owner scoped; returns only the calling tenant's data.
- All policy mutations recorded in `plan_audit_events` with actor and previous state (FR-017).
- Tenant isolation: every query filters on `tenant_id`; no cross-tenant leakage (FR-018).
- No secrets introduced by this feature.

## Sequence of Implementation

| Step | Description | Depends On |
|---|---|---|
| T06-1 | Write migration SQL (`102-plan-transition-policies.sql`) | — |
| T06-2 | Implement `transitionPolicyEvaluator.mjs` + unit tests | T06-1 |
| T06-3 | Implement `excessConditionDetector.mjs` + unit tests | T06-2 |
| T06-4 | Implement transition rule CRUD actions (`transition-rule-*.mjs`) | T06-1 |
| T06-5 | Implement excess policy CRUD + evaluate actions | T06-2, T06-3 |
| T06-6 | Modify `plan-assign` action to invoke policy evaluation | T06-2, T06-3 |
| T06-7 | Implement `grace-period-sweep.mjs` action + alarm trigger | T06-3 |
| T06-8 | Implement `over-limit-status-get.mjs` action | T06-3 |
| T06-9 | Implement `transitionPolicyEventEmitter.mjs` | T06-2 |
| T06-10 | APISIX route additions + scope enforcement hook for creation blocking | T06-6 |
| T06-11 | Console pages (ConsolePlanTransitionRulesPage, ConsolePlanExcessPolicyPage, ConsoleTenantOverLimitStatusPage) | T06-6 |
| T06-12 | Integration test suite | T06-6, T06-7, T06-8, T06-10 |
| T06-13 | Helm values update (new env vars) | T06-6 |

**Parallelizable**: T06-4 and T06-5 can proceed in parallel with T06-2/T06-3. T06-11 (console) can begin after T06-5 contracts are finalized. T06-12 gates on T06-6 through T06-10.

## Criteria of Done

| Criterion | Evidence |
|---|---|
| Migration runs cleanly on empty and populated databases | CI migration test passes |
| Blocked transition returns 422 before any DB mutation | Integration test `limit-excess-block-transition.test.mjs` asserts DB state unchanged |
| Grace period created on downgrade with `grace_period` policy | Integration test asserts `tenant_grace_period_records` row + Kafka event |
| Sweep escalates expired grace period within 15 min | Integration test with mocked time + sweep call asserts `status = expired_escalated` and `tenant_over_limit_conditions.policy_mode = block_creation` |
| Creation blocked for `block_creation` dimension | Integration test asserts 403 + correct error body |
| Policy resolution hierarchy is deterministic | Unit test covers all 8 combination cases (D>T>P, D>T, D>P, T>P, D only, T only, P only, none) |
| Concurrent transition guard returns 409 | Integration test fires two concurrent requests, asserts exactly one succeeds |
| Upgrade path produces no over-limit records | Integration test asserts zero rows in `tenant_over_limit_conditions` after upgrade |
| Every transition attempt produces audit record | Integration test asserts `plan_transition_audit_events` row exists for allowed, blocked-by-rule, blocked-by-excess, and no-op outcomes |
| Superadmin can query hypothetical policy evaluation | `excess-policy-evaluate` action returns correct resolved policy per dimension without side effects |
| Tenant owner can view over-limit status | `over-limit-status-get` returns only calling tenant's data; cross-tenant isolation verified |
| Feature flag `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false` disables enforcement silently | Integration test with flag off verifies transition proceeds without policy evaluation |
| All Kafka events match JSON schema in `contracts/kafka-events.json` | Contract test suite passes |
