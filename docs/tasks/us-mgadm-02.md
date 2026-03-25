# US-MGADM-02 — MongoDB structural administration surface, segregation metadata, quotas, templates, and bounded validation coverage

## Scope implemented

- Safe MongoDB collection configuration with validation policies, time-series options, TTL controls, clustered collection metadata, and pre/post image guardrails.
- Dedicated structural administration contracts for MongoDB indexes, controlled rebuilds, and read-only views.
- Metadata exposure for MongoDB collections, indexes, validations, sizing, views, and inventory projections.
- Tenant-selectable MongoDB segregation model reflected in compatibility summaries, normalized resources, inventory snapshots, and mutation envelopes.
- Tenant database and collection quotas plus workspace-scoped collection onboarding templates.
- Regression coverage for adapter behavior, contracts, public routes, generated OpenAPI, and inventory projections.

## Notes

- MongoDB segregation is modeled as `workspace_database` or `tenant_database`, in addition to cluster isolation (`shared_cluster` or `dedicated_cluster`).
- Controlled index rebuilds require explicit approval evidence and stay serialized with `maxParallelCollections=1`.
- MongoDB views remain bounded to read-only aggregation pipelines and reject `$out` / `$merge` stages.
- Inventory snapshots now publish indexes, views, templates, segregation metadata, and collection sizing / validation summaries.

## Validation

Validated with:

- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`
- `npm run validate:service-map`
- `npm run validate:public-api`
- `npm run validate:openapi`
