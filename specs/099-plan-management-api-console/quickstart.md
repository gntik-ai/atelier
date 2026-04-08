# Quickstart — 099-plan-management-api-console

Implementation checklist and verification entry points for this spec slice.

## Implemented surfaces

- APISIX routes in `services/gateway-config/routes/plan-management-routes.yaml`
- Platform public OpenAPI family updates in `apps/control-plane/openapi/families/platform.openapi.json`
- Console API client in `apps/web-console/src/services/planManagementApi.ts`
- Superadmin pages under `apps/web-console/src/pages/ConsolePlan*.tsx`
- Tenant owner page in `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx`

## Commands

Run the following validation commands:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
pnpm --filter @in-falcone/web-console test
node --test tests/integration/099-plan-management-api-console/*.test.mjs
```

## Manual smoke checks

1. Open `/console/plans` as superadmin.
2. Create a draft plan.
3. Open plan detail and update lifecycle/limits.
4. Open `/console/tenants/:tenantId/plan` and assign an active plan.
5. Open `/console/my-plan` as tenant owner.
6. Verify the limits profile and capability badges render.
