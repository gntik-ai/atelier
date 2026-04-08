# US-IAM-02 — Administrative CRUD for realms, clients, roles, scopes, and users

## Story summary

Deliver the normalized administrative IAM surface for In Falcone so platform and tenant operators can manage Keycloak-backed realms, clients, roles, scopes, and users through BaaS-native contracts instead of raw provider payloads.

## Backlog-to-artifact traceability

- **T01 — control-plane Keycloak Admin adapter baseline**
  - `services/internal-contracts/src/internal-service-map.json`
  - `services/adapters/src/keycloak-admin.mjs`
  - `tests/contracts/keycloak-admin.compatibility.test.mjs`
- **T02 — BaaS-native administrative endpoints/contracts and normalized errors**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `apps/control-plane/src/iam-admin.mjs`
  - `services/internal-contracts/src/public-api-taxonomy.json`
  - `services/gateway-config/base/public-api-routing.yaml`
- **T03 — CRUD/listing/activation/deactivation/reset/attributes/groups support**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `services/adapters/src/keycloak-admin.mjs`
  - `tests/adapters/keycloak-admin.test.mjs`
- **T04 — business validations for invalid/conflicting IAM configurations**
  - `services/adapters/src/keycloak-admin.mjs`
  - `tests/adapters/keycloak-admin.test.mjs`
  - `tests/unit/iam-admin.test.mjs`
- **T05 — compatibility coverage for supported Keycloak versions**
  - `services/adapters/src/keycloak-admin.mjs`
  - `tests/contracts/keycloak-admin.compatibility.test.mjs`
- **T06 — operator/developer examples for API and console paths**
  - `docs/reference/architecture/iam-administration.md`
  - `docs/reference/architecture/public-api-surface.md`

## Executable plan

1. Extend the service-map boundary so `control_api` emits normalized `iam_admin_request` envelopes and `provisioning_orchestrator` mediates the Keycloak Admin adapter.
2. Publish a new `/v1/iam/*` public API family with stable schemas for realms, clients, roles, scopes, users, state changes, and credential resets.
3. Normalize Keycloak provider payloads and dependency failures into BaaS-native resource contracts and error envelopes.
4. Enforce cross-field validations that stop unsafe IAM combinations before they reach Keycloak.
5. Regenerate the family contracts, route catalog, and published API surface docs.
6. Add test coverage for contract validity, compatibility matrix expectations, route-catalog visibility, and validation behavior.
