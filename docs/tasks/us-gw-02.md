# US-GW-02 — APISIX OIDC protection, passthrough governance, and access-matrix coverage

## Scope delivered

This story adds the gateway policy layer that sits between the unified product API and the native control surfaces exposed only for operational break-glass paths.

Delivered artifacts:

- declarative `gatewayPolicy` values in the Helm umbrella chart
- APISIX route reconciliation entries for:
  - legacy platform surfaces (`/control-plane/*`, `/auth/*`, `/realtime/*`, `/*`)
  - public product families under `/v1/*`
  - public `/health`
  - native passthrough routes for Keycloak admin and OpenWhisk admin
- OIDC and claims-propagation metadata for APISIX + downstream services
- CORS/header policy and family-level tenant/plan binding metadata
- access-matrix assertions for `basic_profile`, `tenant_admin`, and `superadmin`
- validation/test coverage plus troubleshooting documentation

## Main decisions

### Product API vs native passthrough

- Product API routes remain the supported interface for tenants and workspaces.
- Native passthrough routes are intentionally separate under `/_native/*`.
- Passthrough is not part of the normal product contract and is controlled by explicit environment mode:
  - `dev`: `enabled`
  - `sandbox`: `limited`
  - `staging`: `disabled`
  - `prod`: `disabled`

### Security posture

- APISIX routes declare OIDC enforcement against Keycloak discovery metadata.
- Auth context is propagated through a fixed approved header set only.
- Incoming spoofable context headers are stripped before downstream forwarding.
- Passthrough routes require elevated scopes, superadmin role alignment, and mandatory audit logging.

### Policy model

- `services/gateway-config/base/public-api-routing.yaml` now carries family-level gateway metadata.
- `services/internal-contracts/src/public-route-catalog.json` now exposes gateway-oriented fields per operation.
- Helm values remain the deployment source of truth for environment-specific OIDC and passthrough behavior.

## Validation

Primary validation entry points:

- `npm run validate:public-api`
- `npm run validate:gateway-policy`
- `npm test -- tests/unit/gateway-policy.test.mjs tests/contracts/gateway-policy.contract.test.mjs tests/resilience/gateway-access-matrix.test.mjs`

## Known implementation risk

`US-IAM-01` is still pending, so the Keycloak-side permission model and token claim shape are treated as integration risk. The gateway layer is therefore implemented with explicit contract assumptions:

- realm: `in-falcone-platform`
- passthrough scopes:
  - `gateway.native.keycloak.admin`
  - `gateway.native.openwhisk.admin`
- downstream claims:
  - `tenant_id`
  - `workspace_id`
  - `plan_id`
  - `preferred_username`
  - `realm_access.roles`

If IAM lands with different claim keys or permission names, only the declarative policy values and validation fixtures should need adjustment.
