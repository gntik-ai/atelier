# PostgreSQL Data API

REST API for row-level CRUD operations on PostgreSQL tables within a workspace.

All operations are workspace-scoped with automatic tenant isolation via Row-Level Security (RLS).

## Base URL

```
/v1/postgres/:workspaceId
```

## Endpoints

### Query Rows

```
GET /v1/postgres/:workspaceId/rows/:table
```

#### Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `select` | string | Comma-separated columns | `select=name,price` |
| `order` | string | Sort order | `order=price.desc` |
| `limit` | number | Max rows (default: 20, max: 1000) | `limit=50` |
| `offset` | number | Skip rows | `offset=20` |

#### Filter Operators

Apply filters as query parameters using the format `column=operator.value`:

| Operator | SQL Equivalent | Example |
|----------|---------------|---------|
| `eq` | `=` | `status=eq.active` |
| `neq` | `!=` | `status=neq.deleted` |
| `gt` | `>` | `price=gt.100` |
| `gte` | `>=` | `price=gte.100` |
| `lt` | `<` | `price=lt.50` |
| `lte` | `<=` | `price=lte.50` |
| `like` | `LIKE` | `name=like.*phone*` |
| `ilike` | `ILIKE` | `name=ilike.*PHONE*` |
| `in` | `IN` | `status=in.(active,pending)` |
| `is` | `IS` | `deleted_at=is.null` |

#### Example

```bash
curl "http://localhost:9080/v1/postgres/$WKS/rows/products?\
select=id,name,price,category&\
category=eq.electronics&\
price=gte.50&\
price=lte.200&\
order=price.desc&\
limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01"
```

#### Response

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Wireless Headphones",
      "price": 79.99,
      "category": "electronics"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 1,
    "hasMore": false
  }
}
```

---

### Insert Rows

```
POST /v1/postgres/:workspaceId/rows/:table
```

**Single insert:**

```json
{
  "name": "Laptop Stand",
  "price": 45.00,
  "category": "accessories"
}
```

**Batch insert:**

```json
[
  { "name": "USB-C Cable", "price": 12.99, "category": "accessories" },
  { "name": "Monitor Arm", "price": 89.99, "category": "accessories" }
]
```

**Required Headers:**
- `Idempotency-Key` — Ensures at-most-once delivery

**Response:** `201 Created`

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Laptop Stand",
      "price": 45.00,
      "category": "accessories",
      "created_at": "2024-01-15T10:00:00.000Z"
    }
  ],
  "inserted": 1
}
```

---

### Update Rows

```
PATCH /v1/postgres/:workspaceId/rows/:table
```

Applies updates to rows matching the query parameters.

**Query parameters** use the same filter operators as GET.

**Body:**

```json
{
  "price": 69.99,
  "updated_at": "2024-01-16T10:00:00.000Z"
}
```

**Example:** Update all electronics under $100:

```bash
curl -X PATCH "http://localhost:9080/v1/postgres/$WKS/rows/products?\
category=eq.electronics&\
price=lt.100" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: update-001" \
  -d '{ "price": 69.99 }'
```

**Response:** `200 OK`

```json
{
  "updated": 3
}
```

---

### Delete Rows

```
DELETE /v1/postgres/:workspaceId/rows/:table
```

Deletes rows matching the query parameters.

**Example:** Delete all archived products:

```bash
curl -X DELETE "http://localhost:9080/v1/postgres/$WKS/rows/products?\
status=eq.archived" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: delete-001"
```

**Response:** `200 OK`

```json
{
  "deleted": 5
}
```

---

### Single Row Operations

```
GET    /v1/postgres/:workspaceId/rows/:table/:primaryKey
PATCH  /v1/postgres/:workspaceId/rows/:table/:primaryKey
DELETE /v1/postgres/:workspaceId/rows/:table/:primaryKey
```

Operate on a single row by its primary key value.

---

### Relations (Joins)

Include related data by specifying relations:

```bash
curl "http://localhost:9080/v1/postgres/$WKS/rows/orders?\
select=id,total,customer:customers(name,email)&\
order=created_at.desc" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01"
```

Response includes nested related data:

```json
{
  "data": [
    {
      "id": "order-001",
      "total": 198.95,
      "customer": {
        "name": "Jane Doe",
        "email": "jane@acme.com"
      }
    }
  ]
}
```

---

## Security

### Tenant Isolation

Every query is automatically scoped to the authenticated tenant via RLS:

```sql
-- Automatically applied by the platform
SET LOCAL app.tenant_id = 'tnt_01HXXX';
SET LOCAL app.workspace_id = 'wks_01HXXX';

-- RLS policy ensures only the tenant's data is visible
SELECT * FROM products WHERE ... ;  -- RLS filter applied automatically
```

### Role-Based Access

| Operation | Required Scope |
|-----------|---------------|
| `SELECT` | `postgres:read` |
| `INSERT` | `postgres:write` |
| `UPDATE` | `postgres:write` |
| `DELETE` | `postgres:write` |

### Row-Level Authorization

Tables can define custom RLS policies for fine-grained access:

```sql
-- Example: users can only see their own orders
CREATE POLICY user_orders ON orders
  USING (user_id = current_setting('app.user_id'));
```
