# PostgreSQL Data API

The PostgreSQL Data API exposes a workspace-scoped REST surface for row-level CRUD and query operations over declared PostgreSQL tables.

## Route model

Base collection route:

- `GET /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows`
- `POST /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows`

Single-row route:

- `GET /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key`
- `PATCH /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key`
- `DELETE /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key`

## Read semantics

Supported read controls:

- projection with `select`
- one-hop declared relations with `include`
- filtering with `filter[...]`
- ordering with `order`
- cursor pagination with `page[size]` and `page[after]`

### Filters

Supported operators:

- equality and comparison: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- set membership: `in`
- pattern matching: `like`, `ilike`
- ranges: `between`
- null checks: `is` with `null` or `not_null`
- JSON-aware operators: `json_contains`, `json_path_eq`

Examples:

- `filter[status][eq]=open`
- `filter[totalAmount][gte]=100`
- `filter[totalAmount][between][]=100&filter[totalAmount][between][]=500`
- `filter[payload][json_path_eq][priority]=high`

### Relations

`include` accepts only declared one-hop relations. The server appends join predicates and RLS predicates for each related table before embedding the relation payload.

Example:

- `select=id,status,totalAmount&include=customer&order=createdAt:desc`

## Write semantics

- `POST` inserts one row.
- `PATCH` updates one row selected through the deep-object `pk` selector.
- `DELETE` deletes one row selected through the deep-object `pk` selector.
- Mutations require `Idempotency-Key`.

Example primary-key selector:

- `pk[id]=ord_003`

## Security model

The Data API enforces all of the following together:

1. workspace-scoped authorization from the public control plane
2. effective-role resolution against the allowed runtime roles
3. schema `USAGE` plus table-level object grants for the requested command
4. row-level-security policy presence when RLS is enabled
5. runtime row predicates derived from session context for both base tables and joined relations

If a related table is not reachable through the effective grant surface, the query is rejected rather than silently widening access.

## Notes

- Only declared tables and declared one-hop relations are supported.
- Joined relations are read-only in this feature scope.
- Cursor pagination uses stable ordering with primary-key tie-breakers appended automatically.
