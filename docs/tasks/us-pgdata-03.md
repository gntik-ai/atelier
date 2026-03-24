# US-PGDATA-03 — Bulk ops, import/export, scoped keys, saved queries, and stable endpoints

## Scope implemented

- Bulk insert, bulk update, and bulk delete routes with configurable batch limits and shared RLS-aware planning.
- JSON and CSV import/export contracts with validation expectations, restore metadata, and trace-friendly envelopes.
- Scoped PostgreSQL Data API credentials limited by logical database, schema, table, routine, saved query, or stable endpoint.
- Reusable saved queries plus stable endpoint publication and invocation contracts for saved queries, views, and routines.
- Optional count and pagination metadata on row collections, export manifests, saved-query execution, and stable endpoint invocation.
- Actor, tenant, workspace, correlation, and origin-surface traceability in PostgreSQL data planning and published response envelopes.
- Contract, adapter, resilience, and console-oriented coverage for the expanded PostgreSQL Data API surface.

## Notes

- The feature remains contract-first: OpenAPI is the public source of truth, public-route artifacts are regenerated from it, and adapter helpers model safe SQL planning rather than a live database runtime.
- Bulk and import flows enforce configurable limits before SQL generation so gateway and adapter callers can fail early and predictably.
- Saved queries and stable endpoints are intentionally represented as governed metadata plus execution plans, preserving room for future persistence and publication mechanics.
- Scoped credentials remain secret-safe in stored artifacts while still exposing a one-time secret delivery envelope in the public contract.
- Declared dependency `US-PLAN-02` is still pending; the resulting implementation risk is documented but does not block the contract surface shipped here.

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
