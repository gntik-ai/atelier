# Plan Enforcement Coherence Test Suite

> **US-PLAN-02-T06** — Validates that the five plan-enforcement subsystems (T01–T05) work coherently end-to-end.

## Purpose

This suite verifies cross-subsystem coherence for:

- Entitlement resolution ↔ Gateway enforcement
- Entitlement resolution ↔ Console API display
- Gateway ↔ Console coherence
- Plan change propagation (upgrade / downgrade)
- Override lifecycle (create / revoke / expire)
- Hard and soft quota enforcement
- Workspace sub-quota enforcement
- Capability-quota orthogonality
- Multi-tenant isolation
- Deny-by-default on resolution failure
- Audit event emission on enforcement rejections

## Prerequisites

- All T01–T05 subsystems deployed and operational
- Keycloak realm configured with test clients
- Kafka cluster with audit topic available
- Environment variables configured (see below)

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GATEWAY_BASE_URL` | ✅ | `http://localhost:9080` | APISIX gateway URL |
| `CONTROL_PLANE_URL` | ✅ | `http://localhost:3233` | Control plane URL |
| `CONSOLE_API_URL` | | `http://localhost:3000/api` | Console API URL |
| `KEYCLOAK_URL` | ✅ | `http://localhost:8080` | Keycloak URL |
| `KEYCLOAK_REALM` | | `falcone` | Keycloak realm |
| `SUPERADMIN_CLIENT_ID` | ✅ | — | Superadmin OAuth client ID |
| `SUPERADMIN_CLIENT_SECRET` | ✅ | — | Superadmin OAuth client secret |
| `KAFKA_BROKERS` | | `localhost:9092` | Kafka broker addresses |
| `KAFKA_AUDIT_TOPIC` | | `platform.audit.events` | Audit event topic |
| `PROPAGATION_TTL_MS` | | `30000` | Max propagation wait (ms) |
| `BROWSER_TEST_ENABLED` | | `false` | Enable Playwright browser tests |
| `PLAYWRIGHT_BASE_URL` | | `http://localhost:3000` | Console URL for browser tests |

## Running Locally

```bash
# Set required env vars
export GATEWAY_BASE_URL=http://localhost:9080
export CONTROL_PLANE_URL=http://localhost:3233
export KEYCLOAK_URL=http://localhost:8080
export SUPERADMIN_CLIENT_ID=test-superadmin
export SUPERADMIN_CLIENT_SECRET=secret

# Run the full suite
bash tests/integration/plan-enforcement/run-suite.sh

# Or run individual test files
node --test tests/integration/plan-enforcement/suites/01-resolution-gateway-coherence.test.mjs
```

## Running in CI

The suite integrates into the CI pipeline via the `quality` job. If environment variables are not set, tests self-skip gracefully.

## Directory Structure

```text
tests/integration/plan-enforcement/
├── README.md                    # This file
├── run-suite.sh                 # CI/local runner script
├── config/
│   ├── test-env.mjs             # Environment configuration
│   ├── test-plans.mjs           # Test plan definitions (seed data)
│   └── test-capabilities.mjs   # Capability catalogue with gated routes
├── helpers/
│   ├── auth.mjs                 # Keycloak token management
│   ├── api-client.mjs           # Gateway & control plane HTTP client
│   ├── console-api-client.mjs   # Console JSON API client
│   ├── tenant-factory.mjs       # Tenant CRUD
│   ├── plan-factory.mjs         # Plan CRUD & assignment
│   ├── override-factory.mjs     # Override CRUD
│   ├── workspace-factory.mjs    # Workspace & sub-quota CRUD
│   ├── resource-factory.mjs     # Resource creation (DBs, topics, etc.)
│   ├── kafka-consumer.mjs       # Kafka audit event consumer
│   ├── wait-for-propagation.mjs # Polling helper for eventual consistency
│   └── report.mjs               # Structured JSON report generator
└── suites/
    ├── 01-resolution-gateway-coherence.test.mjs
    ├── 02-resolution-console-coherence.test.mjs
    ├── 03-gateway-console-coherence.test.mjs
    ├── 04-plan-change-propagation.test.mjs
    ├── 05-override-propagation.test.mjs
    ├── 06-hard-quota-enforcement.test.mjs
    ├── 07-soft-quota-grace-enforcement.test.mjs
    ├── 08-workspace-subquota-coherence.test.mjs
    ├── 10-deny-by-default.test.mjs
    ├── 11-audit-enforcement-events.test.mjs
    ├── 12-capability-quota-orthogonality.test.mjs
    ├── 13-multi-tenant-isolation.test.mjs
    └── 14-full-lifecycle-e2e.test.mjs
```

## Criteria of Acceptance Coverage

| CA | Test File(s) |
|----|---|
| CA-01 | `01-resolution-gateway-coherence.test.mjs` |
| CA-02 | `02-resolution-console-coherence.test.mjs` |
| CA-03 | `06-hard-quota-enforcement.test.mjs`, `03-gateway-console-coherence.test.mjs` |
| CA-04 | `07-soft-quota-grace-enforcement.test.mjs` |
| CA-05 | `04-plan-change-propagation.test.mjs` |
| CA-06 | `04-plan-change-propagation.test.mjs` |
| CA-07 | `05-override-propagation.test.mjs` |
| CA-08 | `05-override-propagation.test.mjs` |
| CA-09 | `10-deny-by-default.test.mjs` |
| CA-10 | `08-workspace-subquota-coherence.test.mjs` |
| CA-11 | `11-audit-enforcement-events.test.mjs` |
| CA-12 | `12-capability-quota-orthogonality.test.mjs` |
| CA-13 | `run-suite.sh` + CI integration |
| CA-14 | `13-multi-tenant-isolation.test.mjs` |

## Adding New Tests

1. Create a new `.test.mjs` file in `suites/` following the naming convention `NN-description.test.mjs`.
2. Import helpers from `../helpers/` and config from `../config/`.
3. Use `{ skip: !envReady && 'env not configured' }` to self-skip when env is missing.
4. Create dedicated test tenants with `createTestTenant()` and clean up in `after()`.
5. Follow the Arrange → Assert coherence → Teardown pattern.
