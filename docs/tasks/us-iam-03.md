# US-IAM-03 — Console login, signup, activation, and password recovery

## Story summary

Deliver the console authentication surface for In Falcone so operators can log in with username/password, self-register under policy control, wait for superadmin activation when required, and recover expired passwords without falling back to raw Keycloak workflows.

## Backlog-to-artifact traceability

- **T01 — console login and SPA session/token management**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `apps/control-plane/src/console-auth.mjs`
  - `services/gateway-config/base/public-api-routing.yaml`
  - `charts/in-falcone/values.yaml`
- **T02 — self-service signup with pending activation**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `services/internal-contracts/src/domain-model.json`
  - `services/internal-contracts/src/public-api-taxonomy.json`
- **T03 — superadmin activation workflow**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `services/internal-contracts/src/domain-model.json`
  - `tests/contracts/control-plane.openapi.test.mjs`
- **T04 — password recovery and reset**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `charts/in-falcone/values.yaml`
  - `tests/contracts/public-api.catalog.test.mjs`
- **T05 — global/environment/plan auto-signup policy controls**
  - `charts/in-falcone/values.yaml`
  - `charts/in-falcone/values.schema.json`
  - `scripts/lib/deployment-chart.mjs`
- **T06 — status views, user messaging, and test scaffolding**
  - `tests/reference/testing-strategy.yaml`
  - `tests/reference/reference-dataset.json`
  - `docs/reference/architecture/console-authentication.md`

## Executable plan

1. Publish the new `/v1/auth/*` contracts for login, signup, activation decisions, password recovery, and explicit status views.
2. Extend the canonical platform-user model so self-service registrations can pause in `pending_activation` without inventing a second user identity.
3. Reconfigure gateway routing and chart defaults so the auth family can mix anonymous entry points with delegated OIDC enforcement.
4. Expose chart-level signup policy overrides for global, environment, and plan-driven activation behavior.
5. Regenerate the route catalog and published public API docs.
6. Expand console/e2e scaffolding so pending activation, suspended accounts, and expired credentials remain first-class UX states.
