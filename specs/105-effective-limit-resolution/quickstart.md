# Quickstart: Effective Limit Resolution (105)

## Prerequisites

Ensure T01 and T02 migrations are applied:

```bash
# From repo root
psql $DATABASE_URL -f services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql
psql $DATABASE_URL -f services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql
psql $DATABASE_URL -f services/provisioning-orchestrator/src/migrations/105-effective-limit-resolution.sql
```

Verify prerequisites:

```bash
psql $DATABASE_URL -c "\dt quota_dimension_catalog quota_overrides boolean_capability_catalog workspace_sub_quotas"
# All four tables must be present
```

## Running Integration Tests

```bash
# From repo root
cd tests/integration/105-effective-limit-resolution

# Seed fixtures
node fixtures/seed-plans-with-quotas-and-capabilities.mjs
node fixtures/seed-overrides.mjs
# (seed-sub-quotas.mjs is optional — tests create their own sub-quotas)

# Run all tests for this feature
node --test unified-entitlements.test.mjs
node --test workspace-sub-quota-crud.test.mjs
node --test workspace-effective-limits.test.mjs
node --test upstream-change-reflection.test.mjs
node --test inconsistency-detection.test.mjs
node --test concurrency.test.mjs
node --test isolation.test.mjs

# Or run all at once:
node --test *.test.mjs
```

## Invoking Actions Locally (OpenWhisk dev mode)

```bash
# Resolve unified entitlements for a tenant
wsk action invoke tenant-effective-entitlements-get \
  -p tenantId "acme-corp" \
  --result

# Set a workspace sub-quota
wsk action invoke workspace-sub-quota-set \
  -p tenantId "acme-corp" \
  -p workspaceId "ws-prod" \
  -p dimensionKey "max_pg_databases" \
  -p allocatedValue 6 \
  -p actor "admin@example.com" \
  --result

# Get workspace effective limits
wsk action invoke workspace-effective-limits-get \
  -p tenantId "acme-corp" \
  -p workspaceId "ws-prod" \
  --result

# List sub-quotas for a tenant
wsk action invoke workspace-sub-quota-list \
  -p tenantId "acme-corp" \
  --result

# Remove a sub-quota
wsk action invoke workspace-sub-quota-remove \
  -p tenantId "acme-corp" \
  -p workspaceId "ws-prod" \
  -p dimensionKey "max_pg_databases" \
  -p actor "admin@example.com" \
  --result
```

## Migration Rollback

```bash
# Rollback: drops workspace_sub_quotas table and its indexes
psql $DATABASE_URL -c "DROP TABLE IF EXISTS workspace_sub_quotas CASCADE;"
# Note: quota_dimension_catalog FK is ON DELETE RESTRICT — this drop is safe
# (the catalog table is not dropped, only the sub-quotas referencing it)
```

## Verifying Kafka Events

```bash
# Using kafkajs CLI or kafka-console-consumer:
kafka-console-consumer --bootstrap-server $KAFKA_BROKERS \
  --topic console.quota.sub_quota.set \
  --from-beginning

kafka-console-consumer --bootstrap-server $KAFKA_BROKERS \
  --topic console.quota.sub_quota.inconsistency_detected \
  --from-beginning
```

## Environment Variables

| Variable | Example | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/atelier` | PostgreSQL connection |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker addresses |
| `SUB_QUOTA_KAFKA_TOPIC_SET` | `console.quota.sub_quota.set` | Override default topic name |
| `SUB_QUOTA_KAFKA_TOPIC_REMOVED` | `console.quota.sub_quota.removed` | Override default topic name |
| `SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY` | `console.quota.sub_quota.inconsistency_detected` | Override default topic name |
| `SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS` | `5000` | Serializable TX lock timeout |
