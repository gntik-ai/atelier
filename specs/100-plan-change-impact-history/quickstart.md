# Quickstart — 100-plan-change-impact-history

Implementation and verification notes for the plan change impact history slice.

## Intended implementation surfaces

- PostgreSQL migration in `services/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql`
- History persistence/query repositories in `services/provisioning-orchestrator/src/repositories/`
- Updated assignment action in `services/provisioning-orchestrator/src/actions/plan-assign.mjs`
- New read actions for history and current entitlements
- APISIX route and public API contract updates
- Console history/current-summary UI updates in `apps/web-console/src/`
- Integration and contract tests under `tests/integration/100-plan-change-impact-history/` and `tests/contract/100-plan-change-impact-history/`

## Suggested validation commands

Run from repository root after implementation lands:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
pnpm --filter @in-falcone/web-console test
node --test tests/integration/100-plan-change-impact-history/*.test.mjs
node --test tests/contract/100-plan-change-impact-history/*.test.mjs
```

## Manual smoke flow

1. As superadmin, assign tenant `acme-corp` from `starter` to `professional`.
2. Verify one history entry is created with actor, plans, timestamp, correlation id, and full quota/capability snapshot.
3. Downgrade the same tenant back to `starter` while fixtures keep one or more dimensions over the new limits.
4. Query the admin history endpoint and confirm affected dimensions show `over_limit` with observed usage values.
5. Open the superadmin tenant plan page and confirm the history timeline, filters, and drilldown tables render all dimensions including unchanged ones.
6. Open the tenant-owner current plan page and verify current effective entitlement summary reflects the new plan and flags over-limit dimensions informationally.
7. Confirm the Kafka event `console.plan.change-impact-recorded` is emitted and correlates with structured logs by `historyEntryId` / `correlationId`.

## Operational checks

- Dashboard shows write success rate and query latency for the new endpoints.
- Unknown-usage metrics remain low and do not spike for mandatory sources.
- No logs contain full snapshot payloads or sensitive free-text reasons by default.
