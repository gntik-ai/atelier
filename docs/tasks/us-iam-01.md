# US-IAM-01 — Keycloak platform and tenant IAM model

## Story summary

Define one production-shaped IAM baseline for the platform and tenant spaces on top of Keycloak, including platform-vs-tenant separation, tenant activation provisioning, workspace client modeling, service-account credentials, and the metadata/mappers required by the control plane and APISIX gateway.

## Backlog-to-artifact traceability

- **T01 — platform realm, tenant realm strategy, console-vs-end-user separation**
  - `services/internal-contracts/src/domain-model.json`
  - `services/internal-contracts/src/authorization-model.json`
  - `docs/adr/0009-keycloak-platform-and-tenant-iam.md`
  - `docs/reference/architecture/core-domain-model.md`
- **T02 — automatic IAM provisioning on tenant activation**
  - `services/internal-contracts/src/internal-service-map.json`
  - `services/internal-contracts/src/deployment-topology.json`
  - `charts/in-atelier/templates/bootstrap-script-configmap.yaml`
- **T03 — workspace client/application model**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `services/internal-contracts/src/domain-model.json`
  - `tests/reference/domain-seed-fixtures.json`
- **T04 — service accounts and machine-to-machine credentials**
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `services/internal-contracts/src/authorization-model.json`
  - `services/internal-contracts/src/internal-service-map.json`
- **T05 — naming, metadata, attributes, and mappers required by the control plane**
  - `charts/in-atelier/values.yaml`
  - `charts/in-atelier/values.schema.json`
  - `charts/in-atelier/templates/bootstrap-payload-configmap.yaml`
  - `charts/in-atelier/templates/bootstrap-script-configmap.yaml`
- **T06 — multi-tenant scenarios with multiple workspaces and multiple clients per tenant**
  - `tests/reference/domain-seed-fixtures.json`
  - `tests/unit/domain-model.test.mjs`
  - `tests/contracts/control-plane.openapi.test.mjs`

## Executable plan

1. Extend the canonical domain and authorization contracts with explicit IAM descriptors for platform users, tenants, workspaces, applications, and service accounts.
2. Add a provisioning-facing identity blueprint and update the internal service map so tenant activation and workspace onboarding carry IAM intent explicitly.
3. Extend the control-plane OpenAPI document with read/write IAM fields that describe tenant identity contexts, workspace client boundaries, Keycloak clients, and service-account bindings.
4. Expand the Helm bootstrap payload so the platform realm baseline now includes realm roles, client scopes, platform clients, and a tenant realm template contract.
5. Add fixture/test/doc coverage that proves multi-workspace and multi-client tenant scenarios remain aligned with the shared IAM baseline.
