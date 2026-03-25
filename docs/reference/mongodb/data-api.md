# MongoDB Data API

The MongoDB Data API exposes a workspace-scoped REST surface for tenant-safe document CRUD, bounded bulk write operations, controlled aggregations, JSON import/export flows, topology-aware transactions, and change-stream bridge registration.

## Route model

Base collection route:

- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents`

Single-document route:

- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `PATCH /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `PUT /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `DELETE /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`

Bulk route:

- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/bulk/write`

Advanced routes:

- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/aggregations`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/transactions`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/change-streams`

## Read semantics

Supported read controls:

- validated JSON `filter`
- field-level `projection`
- deterministic `sort`
- cursor pagination with `page[size]` and `page[after]`

### Filters

Supported operators:

- comparisons: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- set membership: `$in`, `$nin`
- existence and pattern checks: `$exists`, `$regex`
- nested-array matching: `$elemMatch`
- logical composition: `$and`, `$or`

Example filter payload:

```json
{
  "status": { "$in": ["active", "paused"] },
  "profile.address.city": "Madrid",
  "$or": [
    { "priority": "high" },
    { "score": { "$gte": 10 } }
  ]
}
```

## Write semantics

- `POST` inserts one document.
- `PATCH` applies bounded MongoDB update operators (`$set`, `$unset`, `$inc`, `$push`, `$pull`).
- `PUT` replaces one document.
- `DELETE` removes one document.
- `POST /bulk/write` accepts bounded `insertOne`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, and `deleteMany` payloads.
- Mutations require `Idempotency-Key`.

## Aggregations

Controlled aggregation pipelines support a bounded subset of MongoDB stages:

- allowed stages: `$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`, `$unwind`, `$lookup`, `$count`, `$facet`, `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`
- blocked stages: `$out`, `$merge`, `$geoNear`
- tenant scoping is injected automatically as the leading `$match` stage when the caller does not already express the same predicate
- planner-side guardrails cap stage count, payload size, sort keys, facet branches, lookup usage, and maximum result window

This feature intentionally enables document analytics without exposing unrestricted provider passthrough execution.

## Import / export

JSON import and export routes are optimized for backup, restore, and controlled tenant data migration workflows:

- imports validate every document against collection rules before adapter execution
- replace and upsert imports require stable `_id` values to guarantee deterministic restore behavior
- exports return a stable manifest-friendly envelope with collection, tenant-scope, and consistency metadata
- imports and exports stay bounded by document-count and payload-size ceilings

## Transactions

Database-scoped transaction requests accept a bounded set of document operations across multiple collections in one logical MongoDB database:

- supported actions: `insert`, `update`, `replace`, `delete`
- transaction support is topology-aware and requires a deployment profile that exposes MongoDB transactions
- request validation preserves tenant scoping, collection validation, unique-index conflict checks, and commit-time guardrails before adapter dispatch

## Change streams

Change-stream registration is exposed as a topology-aware, bridge-aware control-plane contract:

- collection-scoped change streams inject tenant-aware match filters against `fullDocument`, `fullDocumentBeforeChange`, and update deltas
- only safe projection / enrichment stages are accepted on this surface
- transport is normalized through the realtime/event gateway bridge when available
- responses include compatibility metadata so clients can distinguish topology gaps from bridge unavailability

Because the public realtime delivery stack evolves independently, change-stream registration advertises readiness and topic metadata rather than bypassing the gateway directly.

## Tenant segregation

Every document operation stays tenant-scoped:

1. the request filter is narrowed with the effective tenant predicate
2. user-provided filters cannot widen access to another tenant
3. write payloads cannot change the tenant ownership field
4. bulk, aggregation, import/export, transaction, and change-stream operations inherit the same tenant predicate semantics

This feature intentionally models logical segregation inside shared MongoDB databases and collections.

## Collection validation and conflicts

- If a collection declares `$jsonSchema` validation rules, the planner validates inserts, replacements, update candidates, and imported documents before dispatch.
- Request-time unique-index conflicts inside a bulk payload, import batch, or transactional mutation set are rejected deterministically before adapter execution.
- Provider duplicate-key, validation, topology, and change-stream capability failures are normalized into stable API error classes.

## Capability detection

Topology-dependent capabilities are surfaced through Mongo inventory compatibility metadata and per-operation compatibility summaries:

- aggregations, import, and export are available across supported MongoDB deployment profiles
- transactions require a compatible replica-set or sharded topology and an enabled transaction profile
- change streams require both a compatible topology and an available realtime/event gateway bridge

## Notes

- The API is document-oriented and does not expose unrestricted provider passthrough operators.
- Sorting appends `_id` automatically when needed so cursor pagination remains stable.
- Bulk and advanced-operation limits are configurable but always bounded by safe operation-count and payload-size ceilings.
- The bridge-facing change-stream contract is additive and intentionally compatible with future realtime delivery work.
