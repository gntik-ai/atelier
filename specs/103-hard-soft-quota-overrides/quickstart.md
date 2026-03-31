# Quickstart: Hard & Soft Quotas with Superadmin Override

**Feature**: 103-hard-soft-quota-overrides | **Date**: 2026-03-31

## Prerequisites

- Node.js 20+ with pnpm
- PostgreSQL (local or Docker) with migrations from 097 and 098 already applied
- Kafka broker (local or Docker)
- Environment variables configured (see below)

## Setup

### 1. Apply Migration

```bash
# From repo root
psql -U $PGUSER -d $PGDATABASE -f \
  services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql
```

Verify:

```bash
psql -c "\d quota_overrides"
psql -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'quota_type_config'"
```

### 2. Create Kafka Topics

```bash
kafka-topics.sh --create --topic console.quota.override.created --partitions 3 --replication-factor 1 --config retention.ms=2592000000
kafka-topics.sh --create --topic console.quota.override.modified --partitions 3 --replication-factor 1 --config retention.ms=2592000000
kafka-topics.sh --create --topic console.quota.override.revoked --partitions 3 --replication-factor 1 --config retention.ms=2592000000
kafka-topics.sh --create --topic console.quota.override.expired --partitions 3 --replication-factor 1 --config retention.ms=2592000000
kafka-topics.sh --create --topic console.quota.hard_limit.blocked --partitions 3 --replication-factor 1 --config retention.ms=2592000000
kafka-topics.sh --create --topic console.quota.soft_limit.exceeded --partitions 3 --replication-factor 1 --config retention.ms=2592000000
```

### 3. Environment Variables

```bash
export QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED=console.quota.override.created
export QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED=console.quota.override.modified
export QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED=console.quota.override.revoked
export QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED=console.quota.override.expired
export QUOTA_ENFORCEMENT_KAFKA_TOPIC_HARD_BLOCKED=console.quota.hard_limit.blocked
export QUOTA_ENFORCEMENT_KAFKA_TOPIC_SOFT_EXCEEDED=console.quota.soft_limit.exceeded
export QUOTA_OVERRIDE_EXPIRY_SWEEP_INTERVAL_MS=300000
export QUOTA_OVERRIDE_EXPIRY_SWEEP_BATCH_SIZE=100
export QUOTA_OVERRIDE_JUSTIFICATION_MAX_LENGTH=1000
export QUOTA_ENFORCEMENT_LOCK_TIMEOUT_MS=5000
```

## Running Tests

```bash
# From repo root
pnpm --filter provisioning-orchestrator test

# Or run specific test suites
node --test tests/integration/103-hard-soft-quota-overrides/quota-type-classification.test.mjs
node --test tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs
node --test tests/integration/103-hard-soft-quota-overrides/quota-enforcement.test.mjs
node --test tests/integration/103-hard-soft-quota-overrides/quota-override-expiry.test.mjs
node --test tests/integration/103-hard-soft-quota-overrides/quota-audit.test.mjs
node --test tests/integration/103-hard-soft-quota-overrides/quota-isolation.test.mjs
```

## Verification Checklist

1. **Migration**: `\d quota_overrides` shows all columns and indexes
2. **Plans column**: `SELECT quota_type_config FROM plans LIMIT 1` returns `{}`
3. **Override create**: Call `quota-override-create` with valid params → 201 with override ID
4. **Enforcement**: Call `quota-enforce` with usage at limit → hard_blocked decision
5. **Soft grace**: Call `quota-enforce` with soft-limited dimension, usage in grace zone → soft_grace_allowed with warning
6. **Audit**: Query `plan_audit_events` → override lifecycle rows present
7. **Kafka**: Consume from `console.quota.hard_limit.blocked` → enforcement event received
8. **Expiry sweep**: Create override with past `expires_at`, run sweep, verify status = expired

## Key Behavioral Notes

- **Default quota type**: If a dimension has no entry in `plans.quota_type_config`, it is treated as `hard` with grace margin `0`.
- **Unlimited**: Override value or plan value of `-1` skips all quota checks for that dimension.
- **Fail-closed**: If metering is unavailable, enforcement blocks resource creation with a transient error (not a quota error).
- **Override survival**: Overrides persist across plan changes. The effective limit is recomputed dynamically.
- **Grace margin = 0 + soft**: Behaves identically to hard at runtime but classified as soft for reporting/audit purposes.
