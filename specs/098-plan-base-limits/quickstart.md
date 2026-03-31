# Quickstart — 098 Plan Base Limits

## Local migration

Run the prerequisite 097 migration first, then apply this migration:

```bash
psql "$DATABASE_URL" -f services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql
psql "$DATABASE_URL" -f services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql
```

## Environment variables

- `PLAN_LIMITS_KAFKA_TOPIC_UPDATED` (default: `console.plan.limit_updated`)
- `PLAN_LIMITS_LOCK_TIMEOUT_MS` (default: `5000`)

## Run targeted tests

```bash
node --test tests/integration/098-plan-base-limits/
```

## Example action invocations

### quota-dimension-catalog-list

```bash
wsk action invoke quota-dimension-catalog-list -r -p callerContext '{"actor":{"id":"admin-1","type":"superadmin"}}'
```

### plan-limits-set

```bash
wsk action invoke plan-limits-set -r \
  -p planId "plan-123" \
  -p dimensionKey "max_workspaces" \
  -p value 10 \
  -p callerContext '{"actor":{"id":"admin-1","type":"superadmin"}}'
```

### plan-limits-remove

```bash
wsk action invoke plan-limits-remove -r \
  -p planId "plan-123" \
  -p dimensionKey "max_workspaces" \
  -p callerContext '{"actor":{"id":"admin-1","type":"superadmin"}}'
```

### plan-limits-profile-get

```bash
wsk action invoke plan-limits-profile-get -r \
  -p planId "plan-123" \
  -p callerContext '{"actor":{"id":"admin-1","type":"superadmin"}}'
```

### plan-limits-tenant-get

```bash
wsk action invoke plan-limits-tenant-get -r \
  -p tenantId "tenant-a" \
  -p callerContext '{"actor":{"id":"owner-1","type":"tenant-owner","tenantId":"tenant-a"}}'
```

## Default changes

Inherited values are computed from the catalog at read time. If the platform default for a dimension changes, plans without an explicit override immediately reflect the new default.

## Unlimited sentinel

`unlimitedSentinel: true` means the effective value is `-1` and the enforcement layer must interpret that as no upper bound. `0` remains a real zero-capacity limit.
