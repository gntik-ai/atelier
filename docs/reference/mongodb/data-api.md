# MongoDB Data API

The MongoDB Data API exposes a workspace-scoped REST surface for tenant-safe document CRUD and bounded bulk write operations over declared MongoDB collections.

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

## Tenant segregation

Every document operation stays tenant-scoped:

1. the request filter is narrowed with the effective tenant predicate
2. user-provided filters cannot widen access to another tenant
3. write payloads cannot change the tenant ownership field
4. bulk operations inherit the same tenant predicate per operation

This feature intentionally models logical segregation inside shared MongoDB databases and collections.

## Collection validation and conflicts

- If a collection declares `$jsonSchema` validation rules, the planner validates inserts, replacements, and update candidates before dispatch.
- Request-time unique-index conflicts inside a bulk payload are rejected deterministically before adapter execution.
- Provider duplicate-key and validation failures are normalized into stable API error classes.

## Notes

- The API is document-oriented and does not expose unrestricted provider passthrough operators.
- Sorting appends `_id` automatically when needed so cursor pagination remains stable.
- Bulk limits are configurable but always bounded by a safe operation count and payload-size ceiling.
