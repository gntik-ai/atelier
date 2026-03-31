# Data Model: Plan Transition & Limit Excess Policies

## Overview

This document expands the schema summary from `plan.md` into implementation-ready DDL. The feature adds six tables plus an extension to the `plan_audit_events.action_type` constraint.

## Table 1: `plan_transition_compatibility_rules`

Stores superadmin-authored compatibility rules for source/target plan pairs. `NULL` acts as a wildcard.

```sql
CREATE TABLE plan_transition_compatibility_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id    UUID REFERENCES plans(id) NULL,
  target_plan_id    UUID REFERENCES plans(id) NULL,
  disposition       VARCHAR(32) NOT NULL
                      CHECK (disposition IN ('allowed', 'allowed_with_approval', 'blocked')),
  justification     TEXT NULL,
  created_by        VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tcr_source_target
  ON plan_transition_compatibility_rules(source_plan_id, target_plan_id, created_at DESC);

CREATE INDEX idx_tcr_target
  ON plan_transition_compatibility_rules(target_plan_id, created_at DESC);

CREATE INDEX idx_tcr_source_wildcard_target
  ON plan_transition_compatibility_rules(source_plan_id, created_at DESC)
  WHERE target_plan_id IS NULL;

CREATE INDEX idx_tcr_wildcard_source_target
  ON plan_transition_compatibility_rules(target_plan_id, created_at DESC)
  WHERE source_plan_id IS NULL;

CREATE UNIQUE INDEX uq_tcr_exact_pair
  ON plan_transition_compatibility_rules(source_plan_id, target_plan_id)
  WHERE source_plan_id IS NOT NULL AND target_plan_id IS NOT NULL;
```

### Notes on `plan_transition_compatibility_rules`

- Wildcards are represented with `NULL`, not string sentinels.
- Exact duplicate non-wildcard rules are rejected by `uq_tcr_exact_pair`.
- Lookup precedence is enforced in repository logic, not through schema.

## Table 2: `plan_excess_policy_config`

Stores the three policy layers: platform default, transition override, dimension override.

```sql
CREATE TABLE plan_excess_policy_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type        VARCHAR(32) NOT NULL
                      CHECK (scope_type IN ('platform_default', 'transition', 'dimension')),
  source_plan_id    UUID REFERENCES plans(id) NULL,
  target_plan_id    UUID REFERENCES plans(id) NULL,
  dimension_key     VARCHAR(64) NULL REFERENCES quota_dimension_catalog(dimension_key),
  policy_mode       VARCHAR(32) NOT NULL
                      CHECK (policy_mode IN ('grace_period', 'block_creation', 'block_transition')),
  grace_period_days INT NULL CHECK (grace_period_days > 0),
  created_by        VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pepc_grace_days_required CHECK (
    (policy_mode = 'grace_period' AND grace_period_days IS NOT NULL) OR
    (policy_mode <> 'grace_period')
  ),
  CONSTRAINT chk_pepc_platform_shape CHECK (
    scope_type <> 'platform_default' OR
    (source_plan_id IS NULL AND target_plan_id IS NULL AND dimension_key IS NULL)
  ),
  CONSTRAINT chk_pepc_transition_shape CHECK (
    scope_type <> 'transition' OR
    (source_plan_id IS NOT NULL AND target_plan_id IS NOT NULL AND dimension_key IS NULL)
  ),
  CONSTRAINT chk_pepc_dimension_shape CHECK (
    scope_type <> 'dimension' OR
    (source_plan_id IS NULL AND target_plan_id IS NULL AND dimension_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_pepc_platform_default
  ON plan_excess_policy_config(scope_type)
  WHERE scope_type = 'platform_default';

CREATE UNIQUE INDEX uq_pepc_transition_scope
  ON plan_excess_policy_config(source_plan_id, target_plan_id)
  WHERE scope_type = 'transition';

CREATE UNIQUE INDEX uq_pepc_dimension_scope
  ON plan_excess_policy_config(dimension_key)
  WHERE scope_type = 'dimension';

CREATE INDEX idx_pepc_scope_type
  ON plan_excess_policy_config(scope_type, created_at DESC);
```

### Notes on `plan_excess_policy_config`

- Shape constraints prevent mixed-scope rows.
- Only one platform default row may exist.
- `grace_period_days` is mandatory only for `grace_period` rows.

## Table 3: `plan_transition_audit_events`

One complete audit record per transition evaluation attempt.

```sql
CREATE TABLE plan_transition_audit_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                VARCHAR(255) NOT NULL,
  source_plan_id           UUID NULL REFERENCES plans(id),
  target_plan_id           UUID NOT NULL REFERENCES plans(id),
  actor_id                 VARCHAR(255) NOT NULL,
  correlation_id           VARCHAR(255) NULL,
  transition_direction     VARCHAR(32) NOT NULL,
  compatibility_rule_id    UUID NULL REFERENCES plan_transition_compatibility_rules(id),
  rule_disposition         VARCHAR(32) NULL,
  final_outcome            VARCHAR(32) NOT NULL
                             CHECK (final_outcome IN (
                               'allowed',
                               'allowed_with_approval',
                               'blocked_by_rule',
                               'blocked_by_excess',
                               'no_op'
                             )),
  over_limit_dimensions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_evaluation_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ptae_tenant_created
  ON plan_transition_audit_events(tenant_id, created_at DESC);

CREATE INDEX idx_ptae_created
  ON plan_transition_audit_events(created_at DESC);

CREATE INDEX idx_ptae_target_created
  ON plan_transition_audit_events(target_plan_id, created_at DESC);
```

### Notes on `plan_transition_audit_events`

- Exists even for blocked and no-op outcomes.
- JSONB fields hold the per-dimension evaluation summary used by the console and audits.

## Table 4: `tenant_transitions_in_progress`

Guards against concurrent plan transitions for the same tenant.

```sql
CREATE TABLE tenant_transitions_in_progress (
  tenant_id    VARCHAR(255) NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  PRIMARY KEY (tenant_id, started_at)
);

CREATE UNIQUE INDEX uq_ttip_tenant_active
  ON tenant_transitions_in_progress(tenant_id)
  WHERE completed_at IS NULL;
```

### Notes on `tenant_transitions_in_progress`

- The partial unique index is the concurrency guard.
- `completed_at` must be written in a `finally` path to avoid stale locks.

## Table 5: `tenant_grace_period_records`

Tracks active and historical grace periods opened by an allowed downgrade.

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

CREATE INDEX idx_tgpr_tenant_dimension_active
  ON tenant_grace_period_records(tenant_id, dimension_key)
  WHERE status = 'active';

CREATE INDEX idx_tgpr_expiry_lookup
  ON tenant_grace_period_records(expires_at)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_tgpr_tenant_dimension_active
  ON tenant_grace_period_records(tenant_id, dimension_key)
  WHERE status = 'active';
```

### Notes on `tenant_grace_period_records`

- Only one active grace period per tenant and dimension is allowed.
- Historical records are preserved after resolution or escalation.

## Table 6: `tenant_over_limit_conditions`

Tracks active, deferred, or resolved over-limit conditions produced during evaluation or escalation.

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
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tolc_policy_mode CHECK (
    policy_mode IN ('grace_period', 'block_creation', 'block_transition')
  )
);

CREATE INDEX idx_tolc_tenant_dimension_active
  ON tenant_over_limit_conditions(tenant_id, dimension_key)
  WHERE evaluation_status = 'active';

CREATE INDEX idx_tolc_tenant_status
  ON tenant_over_limit_conditions(tenant_id, evaluation_status, created_at DESC);

CREATE UNIQUE INDEX uq_tolc_tenant_dimension_active
  ON tenant_over_limit_conditions(tenant_id, dimension_key)
  WHERE evaluation_status = 'active';
```

### Notes on `tenant_over_limit_conditions`

- `block_transition` conditions may be recorded in audit detail even when no active row is persisted.
- Active rows drive tenant communication and creation blocking.

## `plan_audit_events.action_type` extension

The feature adds these action types to the existing audit stream:

- `transition.rule.created`
- `transition.rule.deleted`
- `excess.policy.set`
- `excess.policy.deleted`
- `grace_period.started`
- `grace_period.expired_escalated`
- `grace_period.resolved`
- `over_limit.created`
- `over_limit.resolved`

Example migration pattern:

```sql
ALTER TABLE plan_audit_events
  DROP CONSTRAINT IF EXISTS chk_plan_audit_events_action_type;

ALTER TABLE plan_audit_events
  ADD CONSTRAINT chk_plan_audit_events_action_type CHECK (
    action_type IN (
      'plan.created',
      'plan.updated',
      'plan.deleted',
      'plan.assigned',
      'plan.unassigned',
      'plan.change.impact.calculated',
      'transition.rule.created',
      'transition.rule.deleted',
      'excess.policy.set',
      'excess.policy.deleted',
      'grace_period.started',
      'grace_period.expired_escalated',
      'grace_period.resolved',
      'over_limit.created',
      'over_limit.resolved'
    )
  );
```

> Replace the pre-existing values with the exact live set already enforced in the table before applying the new values above.

## Dependency order for migration

1. `plan_transition_compatibility_rules`
2. `plan_excess_policy_config`
3. `plan_transition_audit_events`
4. `tenant_transitions_in_progress`
5. `tenant_grace_period_records`
6. `tenant_over_limit_conditions`
7. `plan_audit_events` constraint extension

## Derived behavior supported by this model

- Transition compatibility is matched with exact-plus-wildcard precedence.
- Excess policy resolution is deterministic and scoped.
- Grace periods and over-limit conditions are durable and queryable.
- Every transition attempt is auditable, including blocked outcomes.
- Concurrent transitions for the same tenant are rejected at the database layer.
