# US-MGDATA-01 — MongoDB Data API CRUD documental, query validation, and bulk write guardrails

## Scope implemented

- Workspace-scoped MongoDB Data API routes for document listing, single-document fetch, insert, partial update, replace, delete, and bounded bulk write.
- Validated JSON filters, projection, sorting, and cursor pagination on collection reads.
- Tenant-scoped logical segregation enforced across read, write, replace, delete, and bulk operations through injected tenant predicates and payload checks.
- Pre-write validation against collection validation rules when a collection declares `$jsonSchema` constraints.
- Adapter-planning helpers for nested document updates, provider conflict normalization, and configurable bulk request body and operation-count limits.
- Contract, unit, adapter, resilience, and public-API coverage for nested documents, unique-index conflicts, and controlled large-batch scenarios.

## Notes

- The feature is represented as a contract-first MongoDB document Data API surface in OpenAPI plus a planning/validation layer for downstream adapter execution.
- Document routes stay workspace-scoped and collection-scoped so the public gateway never exposes raw provider passthrough semantics.
- Tenant segregation is logical and explicit: filters are always narrowed to the caller tenant scope, and document payloads cannot rebind ownership to another tenant.
- Bulk write stays intentionally bounded through configurable `maxOperations`, `maxPayloadBytes`, and `ordered` controls.
- The public API evolution is additive over the `mongo` family and elevates the unified OpenAPI semver to `1.18.0`.

## Validation

Validated with:

- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`
- `npm run test:e2e:console`
- `npm run test:resilience`
- `npm run validate:service-map`
- `npm run validate:public-api`
- `npm run validate:openapi`
