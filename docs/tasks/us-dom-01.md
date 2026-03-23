# US-DOM-01 Task Breakdown

## Story summary

Deliver one canonical product domain model so downstream modules can reuse the same entity names, identifiers, relationships, lifecycle transitions, and read/write contracts for platform users, tenants, workspaces, external applications, service accounts, and managed resources.

## Backlog-to-artifact traceability

- **T01 — canonical models for platform user, tenant, workspace, external application, service account, managed resource**
  - `services/internal-contracts/src/domain-model.json`
  - `apps/control-plane/src/domain-model.mjs`
- **T02 — shared identifiers/slugs/states/timestamps/metadata baseline**
  - `services/internal-contracts/src/domain-model.json`
  - `scripts/lib/domain-model.mjs`
- **T03 — entity relationships and business integrity rules**
  - `services/internal-contracts/src/domain-model.json`
  - `docs/adr/0006-core-domain-entity-model.md`
  - `docs/reference/architecture/core-domain-model.md`
- **T04 — domain diagram and JSON/OpenAPI base contracts for read/write**
  - `docs/reference/architecture/core-domain-model.md`
  - `services/internal-contracts/src/domain-model.json`
  - `apps/control-plane/openapi/control-plane.openapi.json`
- **T05 — lifecycle events for create/activate/suspend/soft-delete**
  - `services/internal-contracts/src/domain-model.json`
  - `tests/contracts/domain-model.contract.test.mjs`
- **T06 — seed fixtures for tests/demos across tenant/workspace sizes**
  - `tests/reference/domain-seed-fixtures.json`
  - `tests/unit/domain-model.test.mjs`

## Executable plan

1. Add a machine-readable core domain model contract to the shared internal-contracts package.
2. Record the entity, relationship, and lifecycle decisions in a new ADR plus a human-readable architecture note with a domain diagram.
3. Extend the public control-plane OpenAPI document with canonical read/write schemas for the six core entities.
4. Add validation helpers and automated tests for internal consistency, authorization/deployment alignment, and seed fixture integrity.
5. Update repository structure/docs so CI treats the core domain model as a required baseline artifact.
