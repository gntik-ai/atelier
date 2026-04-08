# MongoDB Data API

Document-oriented REST API for CRUD operations on MongoDB collections within a workspace.

All operations include automatic tenant segregation via injected tenant predicates.

## Base URL

```
/v1/mongo/:workspaceId
```

## Endpoints

### Query Documents

```
GET /v1/mongo/:workspaceId/collections/:collection/documents
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter.*` | string | Field filters (e.g., `filter.status=active`) |
| `projection` | string | Comma-separated fields to include |
| `sort` | string | Sort field (prefix `-` for descending) |
| `limit` | number | Max documents (default: 20, max: 1000) |
| `skip` | number | Skip documents |

**Example:**

```bash
curl "http://localhost:9080/v1/mongo/$WKS/collections/orders/documents?\
filter.status=shipped&\
sort=-createdAt&\
limit=10&\
projection=orderId,total,status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01"
```

**Response:**

```json
{
  "data": [
    {
      "_id": "65a5b...",
      "orderId": "ORD-2024-0001",
      "total": 198.95,
      "status": "shipped"
    }
  ],
  "pagination": {
    "limit": 10,
    "skip": 0,
    "total": 1,
    "hasMore": false
  }
}
```

---

### Insert Document

```
POST /v1/mongo/:workspaceId/collections/:collection/documents
```

```json
{
  "orderId": "ORD-2024-0002",
  "customer": { "name": "John Smith", "email": "john@example.com" },
  "items": [
    { "product": "Keyboard", "qty": 1, "unitPrice": 149.99 }
  ],
  "total": 149.99,
  "status": "pending"
}
```

**Response:** `201 Created`

```json
{
  "data": {
    "_id": "65a5c...",
    "orderId": "ORD-2024-0002",
    "...": "..."
  },
  "inserted": 1
}
```

---

### Update Document

```
PATCH /v1/mongo/:workspaceId/collections/:collection/documents/:id
```

Supports MongoDB update operators:

```json
{
  "$set": { "status": "shipped" },
  "$push": {
    "timeline": {
      "event": "shipped",
      "timestamp": "2024-01-16T09:00:00.000Z"
    }
  },
  "$inc": { "version": 1 },
  "$unset": { "tempField": "" }
}
```

**Supported operators:**
| Operator | Description |
|----------|-------------|
| `$set` | Set field values |
| `$unset` | Remove fields |
| `$inc` | Increment numeric fields |
| `$push` | Append to array |
| `$pull` | Remove from array |
| `$addToSet` | Add unique value to array |

---

### Replace Document

```
PUT /v1/mongo/:workspaceId/collections/:collection/documents/:id
```

Replaces the entire document (except `_id` and tenant fields).

---

### Delete Document

```
DELETE /v1/mongo/:workspaceId/collections/:collection/documents/:id
```

---

### Bulk Operations

```
POST /v1/mongo/:workspaceId/collections/:collection/bulk
```

Execute multiple operations atomically:

```json
{
  "operations": [
    {
      "insertOne": {
        "document": { "name": "Product A", "price": 29.99 }
      }
    },
    {
      "updateMany": {
        "filter": { "category": "electronics" },
        "update": { "$set": { "onSale": true } }
      }
    },
    {
      "deleteOne": {
        "filter": { "sku": "DISCONTINUED-001" }
      }
    }
  ]
}
```

**Supported operation types:**
- `insertOne`
- `updateOne` / `updateMany`
- `deleteOne` / `deleteMany`
- `replaceOne`

---

### Aggregation Pipeline

```
POST /v1/mongo/:workspaceId/collections/:collection/aggregate
```

```json
{
  "pipeline": [
    { "$match": { "status": "completed" } },
    { "$group": {
        "_id": "$category",
        "totalRevenue": { "$sum": "$total" },
        "count": { "$sum": 1 }
    }},
    { "$sort": { "totalRevenue": -1 } },
    { "$limit": 10 }
  ]
}
```

**Allowed stages:**
| Stage | Description |
|-------|-------------|
| `$match` | Filter documents |
| `$group` | Group and aggregate |
| `$sort` | Sort results |
| `$limit` | Limit output |
| `$skip` | Skip documents |
| `$project` | Shape output fields |
| `$unwind` | Deconstruct arrays |
| `$lookup` | Join collections |
| `$addFields` | Add computed fields |
| `$count` | Count documents |
| `$bucket` | Categorize into buckets |

::: warning
Pipeline execution is bounded. Stages like `$out` and `$merge` are not allowed for safety.
:::

---

### Change Streams

MongoDB change streams are exposed through the [Realtime Gateway](/api/realtime) via WebSocket subscriptions, not directly through the REST API.

---

### Scoped Credentials

For direct MongoDB access (advanced use cases):

```
POST /v1/mongo/:workspaceId/credentials
```

Returns time-limited credentials scoped to the workspace's database:

```json
{
  "host": "mongodb.in-falcone-dev.svc:27017",
  "database": "wks_01HXXX",
  "username": "wks_01HXXX_readonly",
  "password": "<temporary>",
  "expiresAt": "2024-01-15T11:00:00.000Z",
  "permissions": ["find", "aggregate"]
}
```

---

## Security

### Tenant Segregation

Every MongoDB operation automatically injects a tenant predicate:

```javascript
// User query
{ "status": "active" }

// Actual query executed (tenant predicate injected)
{ "status": "active", "_tenantId": "tnt_01HXXX", "_workspaceId": "wks_01HXXX" }
```

### Error Codes

| Code | Description |
|------|-------------|
| `DOCUMENT_NOT_FOUND` | Document does not exist |
| `DUPLICATE_KEY` | Unique index violation |
| `VALIDATION_ERROR` | Schema validation failed |
| `PERMISSION_DENIED` | Insufficient scopes |
| `CAPABILITY_DISABLED` | MongoDB capability not enabled for workspace |
| `QUOTA_EXCEEDED` | Collection or storage quota exceeded |
