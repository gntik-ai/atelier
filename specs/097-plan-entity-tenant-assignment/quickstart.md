# Quickstart — 097 Plan Entity & Tenant Plan Assignment

## Local setup

1. Ensure PostgreSQL is reachable via `DATABASE_URL`.
2. Optional Kafka verification uses a mock producer in tests by default; real-topic testing can use the `PLAN_KAFKA_TOPIC_*` env vars.
3. Default lock timeout: `PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS=5000`.

## Apply migration

```bash
psql "$DATABASE_URL" -f services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql
```

## Run tests

```bash
node --test tests/integration/097-plan-entity-tenant-assignment/*.test.mjs
```

## Environment variables

- `DATABASE_URL`
- `PLAN_KAFKA_TOPIC_CREATED` (default `console.plan.created`)
- `PLAN_KAFKA_TOPIC_UPDATED` (default `console.plan.updated`)
- `PLAN_KAFKA_TOPIC_LIFECYCLE` (default `console.plan.lifecycle_transitioned`)
- `PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED` (default `console.plan.assignment.created`)
- `PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED` (default `console.plan.assignment.superseded`)
- `PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS` (default `5000`)
