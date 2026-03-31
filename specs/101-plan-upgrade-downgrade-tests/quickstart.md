# Quickstart: Plan Upgrade/Downgrade Verification Tests

## Prerequisites

- T01–T04 are merged and reachable in the target environment.
- The plan-management API is reachable through `TEST_API_BASE_URL`.
- A superadmin token is available in `TEST_SUPERADMIN_TOKEN`.
- PostgreSQL access is available in `TEST_PG_DSN`.
- Tenant provisioning and resource CRUD endpoints are configured when running the live E2E scenarios:
  - `TEST_TENANT_CREATE_PATH`
  - `TEST_TENANT_DELETE_PATH_TEMPLATE`
  - optional `TEST_RESOURCE_PATHS_JSON`

## Run the full suite

```bash
node --test tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs
```

## Run a single scenario

```bash
node --test tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/upgrade-preserves-resources.test.mjs
```

## Environment variables

### Required for live E2E

- `TEST_API_BASE_URL`: APISIX ingress base URL
- `TEST_SUPERADMIN_TOKEN`: superadmin bearer token
- `TEST_PG_DSN`: PostgreSQL DSN

### Optional

- `KAFKA_ENABLED=false`
- `KAFKA_BROKERS`
- `MAX_UNKNOWN_DIMENSIONS_ALLOWED=0`
- `PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS=30000`
- `TEST_RESULT_OUTPUT_PATH`
- `TEST_TENANT_CREATE_PATH`
- `TEST_TENANT_DELETE_PATH_TEMPLATE`
- `TEST_RESOURCE_PATHS_JSON`
- `TEST_USAGE_UNAVAILABLE_PATH`

## Strict vs lenient mode

- Strict CI mode: `MAX_UNKNOWN_DIMENSIONS_ALLOWED=0`
- Lenient exploratory mode: set `MAX_UNKNOWN_DIMENSIONS_ALLOWED=1` or higher

## Output

- TAP output goes to stdout from `node --test`
- JSON summary is printed to stdout, or written to `TEST_RESULT_OUTPUT_PATH` when set

## Interrupted run cleanup

```bash
node tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/teardown.mjs <tenant-id> [...tenant-id]
```

See `plan.md` for scenario details and `spec.md` for acceptance criteria.
