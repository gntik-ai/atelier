# Quickstart: Consumption Visibility Console (106)

## Prerequisites

- T01–T03 fully deployed: `103-hard-soft-quota-overrides`, `104-plan-boolean-capabilities`, `105-effective-limit-resolution` migrations applied and actions registered.
- `pnpm install` run at repo root.
- PostgreSQL running with test database seeded by T01–T03 fixtures.
- Kafka broker running (or `KAFKA_ENABLED=false` for local dev without event verification).

---

## Running Backend Integration Tests

```bash
# From repo root
cd tests/integration/106-consumption-visibility-console

# Seed fixtures (plan, tenant assignment, overrides, sub-quotas, and provisioned resources)
node fixtures/seed-tenant-with-plan-and-resources.mjs
node fixtures/seed-workspace-with-sub-quotas.mjs

# Run all integration tests
node --test tenant-consumption-snapshot.test.mjs
node --test workspace-consumption.test.mjs
node --test allocation-summary.test.mjs
node --test unlimited-dimension.test.mjs
node --test over-limit.test.mjs
node --test isolation.test.mjs

# Or run all at once
node --test *.test.mjs
```

---

## Running Console Component Tests

```bash
# From repo root
cd apps/web-console
pnpm test

# Run only T04-related tests
pnpm vitest run --reporter=verbose src/components/console/ConsumptionBar.test.tsx
pnpm vitest run --reporter=verbose src/components/console/QuotaConsumptionTable.test.tsx
pnpm vitest run --reporter=verbose src/components/console/CapabilityStatusGrid.test.tsx
pnpm vitest run --reporter=verbose src/pages/ConsoleTenantPlanOverviewPage.test.tsx
pnpm vitest run --reporter=verbose src/pages/ConsoleWorkspaceDashboardPage.test.tsx
pnpm vitest run --reporter=verbose src/pages/ConsoleTenantAllocationSummaryPage.test.tsx
```

---

## Manual Dev Verification

### Tenant Plan Overview (P1)

1. Log in as tenant owner for a tenant with a plan assigned and some resources provisioned.
2. Navigate to `/console/my-plan`.
3. Verify:
   - Plan name, status, and description displayed.
   - All quota dimensions listed with consumption bar and effective limit.
   - All 7 capabilities listed with enabled/disabled badges.
   - Dimensions approaching limit (≥ 80%) show amber bar.
   - Over-limit dimensions (if any) show red bar and explicit count.
   - Unlimited dimensions show consumption count and "Unlimited" label without a bar.

### No-Plan State

1. Log in as a tenant owner with no plan assigned.
2. Navigate to `/console/my-plan`.
3. Verify: "No plan assigned" message; all dimensions show catalog default values.

### Superadmin Tenant View (P1)

1. Log in as superadmin.
2. Navigate to `/console/tenants/{tenantId}/plan`.
3. Verify:
   - Entitlement section shows all dimensions with source badges.
   - Overridden dimensions show "Override" badge and original plan value.
   - Over-limit dimensions show red warning with both counts.

### Workspace Dashboard (P2)

1. Log in as workspace admin.
2. Navigate to `/console/workspaces/{workspaceId}`.
3. Verify:
   - Dimensions with sub-quotas show `current / sub-quota` with "workspace allocation" source.
   - Dimensions without sub-quotas show "Shared tenant pool" with tenant-level limit.
   - Capabilities shown as read-only, inherited from tenant plan.

### Allocation Summary (P2)

1. Log in as tenant owner.
2. Navigate to `/console/my-plan/allocation`.
3. Verify:
   - Each dimension shows total, allocated (sum of sub-quotas), and unallocated.
   - Fully allocated dimensions show a "Fully allocated" indicator.
   - Unlimited dimension shows "Unlimited" total and finite allocated sum.

---

## Environment Variables (no new vars in T04)

T04 consumes existing env vars from T01–T03:

| Var | Source | Usage in T04 |
|-----|--------|--------------|
| `DATABASE_URL` | pre-existing | PostgreSQL connection for consumption-repository |
| `KAFKA_BROKERS` | pre-existing | Not used in T04 (read-only, no events) |
| `OPENWHISK_*` | pre-existing | Action invocation |

No new environment variables are introduced in T04.
