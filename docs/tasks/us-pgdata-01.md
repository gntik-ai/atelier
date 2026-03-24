# US-PGDATA-01 — PostgreSQL Data API CRUD/query surface, filters, joins, and RLS-safe coverage

## Scope implemented

- Workspace-scoped PostgreSQL Data API routes for row listing, single-row fetch, insert, update, and delete.
- Dynamic route semantics per workspace, logical database, schema, and table.
- Equality, comparison, IN, LIKE/ILIKE, range, null, and JSON-aware filter support in the query-planning layer.
- Projection, ordering, cursor pagination, and controlled one-hop relation embedding.
- Effective-role resolution with schema/table grants and RLS-aware query planning for base and related tables.
- Contract, adapter, unit, resilience, and E2E-style coverage for related-table reads and restricted-access denial paths.
- Client-facing documentation for route model, supported filters, relations, and mutation selectors.

## Notes

- The feature is represented as a contract-first Data API surface in OpenAPI plus a parameterized PostgreSQL query planner used by tests and adapter-facing integration scaffolding.
- Single-row read/update/delete routes use a deep-object `pk` selector instead of an opaque row identifier so composite primary keys remain representable.
- Relation embedding is intentionally limited to declared one-hop joins in this user story.
- Mutation retries remain protected through `Idempotency-Key` on POST/PATCH/DELETE.

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
