# Quickstart: Plan Transition & Limit Excess Policies

## Prerequisites

- Node.js 20+
- `pnpm`
- PostgreSQL reachable from the local shell
- Kafka available if you want to observe emitted events during manual verification
- A `.env` or shell session exporting the variables used by `services/provisioning-orchestrator`

## 1. Run the migration on a dev database

Set a connection string and apply the feature DDL directly:

```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/falcone_dev'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/provisioning-orchestrator/src/migrations/102-plan-transition-policies.sql
```

### Post-migration checks

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM plan_excess_policy_config;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM tenant_grace_period_records WHERE status = 'active' AND expires_at < NOW();"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM plan_transition_audit_events WHERE final_outcome IS NULL;"
```

Expected results:
- `plan_excess_policy_config` starts at `0` rows until operators configure defaults.
- No expired active grace periods should exist after a sweep run.
- `plan_transition_audit_events` must always report `0` rows with `final_outcome IS NULL`.

## 2. Suggested local environment variables

```bash
export TRANSITION_POLICY_DEFAULT_GRACE_DAYS=14
export TRANSITION_POLICY_DEFAULT_MODE=grace_period
export TRANSITION_POLICY_FALLBACK_ON_MISSING_RULE=allow
export TRANSITION_POLICY_ENFORCEMENT_ENABLED=true
export GRACE_PERIOD_SWEEP_BATCH_SIZE=50
export GRACE_PERIOD_SWEEP_KAFKA_TOPIC_EXPIRED=console.plan.grace_period.expired
export PLAN_TRANSITION_KAFKA_TOPIC_EVALUATED=console.plan.transition.evaluated
export PLAN_TRANSITION_KAFKA_TOPIC_BLOCKED=console.plan.transition.blocked
export PLAN_EXCESS_KAFKA_TOPIC_DETECTED=console.plan.excess.detected
export PLAN_CREATION_BLOCKED_KAFKA_TOPIC=console.plan.creation.blocked
```

## 3. Invoke the new OpenWhisk actions locally

The action files are plain ESM modules. For local dry runs, import the module and call its exported `main` function with a JSON payload.

### Create a transition rule

```bash
node --input-type=module <<'EOF'
import { main } from './services/provisioning-orchestrator/src/actions/transition-rule-create.mjs';

const result = await main({
  auth: {
    subject: 'superadmin-1',
    scopes: ['structural_admin']
  },
  body: {
    sourcePlanId: null,
    targetPlanId: '11111111-1111-1111-1111-111111111111',
    disposition: 'allowed_with_approval',
    justification: 'Downgrade requires operator acknowledgment.'
  }
});

console.log(JSON.stringify(result, null, 2));
EOF
```

### Dry-run policy evaluation

```bash
node --input-type=module <<'EOF'
import { main } from './services/provisioning-orchestrator/src/actions/excess-policy-evaluate.mjs';

const result = await main({
  auth: {
    subject: 'superadmin-1',
    scopes: ['structural_admin']
  },
  body: {
    sourcePlanId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    targetPlanId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenantId: 'tenant-demo'
  }
});

console.log(JSON.stringify(result, null, 2));
EOF
```

### Trigger the grace period sweep

```bash
node --input-type=module <<'EOF'
import { main } from './services/provisioning-orchestrator/src/actions/grace-period-sweep.mjs';

const result = await main({
  auth: {
    subject: 'system:alarm',
    scopes: ['system']
  }
});

console.log(JSON.stringify(result, null, 2));
EOF
```

## 4. Run the integration test suite for feature 102

From the repository root, run the feature-specific integration tests with Node's built-in test runner:

```bash
node --test tests/integration/102-plan-transition-policies/*.test.mjs
```

To run the repository test workflow from the root package scripts:

```bash
pnpm test
```

If you only want the feature-specific contract and unit coverage during development:

```bash
node --test \
  tests/unit/102-plan-transition-policies/*.test.mjs \
  tests/integration/102-plan-transition-policies/*.test.mjs
```

## 5. Manual verification checklist

1. Create a compatibility rule with `blocked` disposition and verify matching `plan-assign` returns `422 TRANSITION_BLOCKED`.
2. Configure a `grace_period` excess policy and downgrade a tenant with usage above the target limit.
3. Verify rows exist in:
   - `plan_transition_audit_events`
   - `tenant_grace_period_records`
   - `tenant_over_limit_conditions`
4. Change a record so `expires_at < NOW()` and run the sweep action.
5. Verify the grace period moves to `expired_escalated` and the over-limit condition is enforced as `block_creation`.

## 6. Deployment note

Keep `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false` for shadow deployment until:
- migrations are applied,
- policy configuration endpoints are reachable,
- audit events are visible,
- and the feature-specific integration suite passes cleanly.
