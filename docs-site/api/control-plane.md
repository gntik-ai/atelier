# Control Plane API

The Control Plane exposes the platform's REST API surface through APISIX, organized into route families under the `/v1/` prefix.

## Common Headers

All API requests require:

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <JWT>` from Keycloak |
| `X-API-Version` | Yes | API version (e.g., `2024-01-01`) |
| `X-Correlation-Id` | Yes | Request correlation ID (`^[A-Za-z0-9._:-]{8,128}$`) |
| `Content-Type` | For mutations | `application/json` |
| `Idempotency-Key` | For mutations | Idempotency key (24h TTL) |

## Route Families

### Platform Management

#### `GET /v1/platform/health`
Returns platform health status.

#### `GET /v1/platform/info`
Returns platform version and configuration metadata.

---

### Tenants

#### `POST /v1/tenants`
Create a new tenant.

```json
{
  "slug": "acme-corp",
  "displayName": "Acme Corporation",
  "plan": "starter",
  "adminEmail": "admin@acme.example.com"
}
```

#### `GET /v1/tenants`
List all tenants. Supports pagination and filtering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `plan` | string | Filter by plan |
| `limit` | number | Page size (default: 20, max: 100) |
| `cursor` | string | Pagination cursor |

#### `GET /v1/tenants/:tenantId`
Get a tenant by ID.

#### `PATCH /v1/tenants/:tenantId`
Update a tenant (plan, display name, status).

#### `DELETE /v1/tenants/:tenantId`
Soft-delete (deactivate) a tenant.

---

### Workspaces

#### `POST /v1/workspaces`
Create a new workspace within a tenant.

```json
{
  "tenantId": "tnt_01HXXX",
  "slug": "dev-environment",
  "displayName": "Development Environment",
  "capabilities": ["postgres", "mongo", "kafka", "storage"]
}
```

#### `GET /v1/workspaces`
List workspaces. Scoped by tenant context from JWT.

#### `GET /v1/workspaces/:workspaceId`
Get workspace details.

#### `PATCH /v1/workspaces/:workspaceId`
Update workspace capabilities or status.

#### `DELETE /v1/workspaces/:workspaceId`
Soft-delete a workspace.

---

### Authentication

#### `POST /v1/auth/token`
Proxy to Keycloak token endpoint.

#### `POST /v1/auth/refresh`
Refresh an access token.

#### `GET /v1/auth/signups/policy`
Returns the current signup policy for the environment.

---

### IAM (Plan-Capability Gated)

::: warning
IAM endpoints require the tenant's plan to have the `identity` capability enabled.
:::

#### `GET /v1/iam/realms`
List Keycloak realms for the current tenant.

#### `POST /v1/iam/realms/:realmId/clients`
Create a new OAuth 2.0 client.

#### `GET /v1/iam/realms/:realmId/roles`
List realm roles.

---

### PostgreSQL Data API

See [PostgreSQL Data API](/api/postgresql) for full reference.

| Endpoint | Description |
|----------|-------------|
| `GET /v1/postgres/:workspaceId/rows/:table` | Query rows |
| `POST /v1/postgres/:workspaceId/rows/:table` | Insert rows |
| `PATCH /v1/postgres/:workspaceId/rows/:table` | Update rows |
| `DELETE /v1/postgres/:workspaceId/rows/:table` | Delete rows |

---

### MongoDB Data API

See [MongoDB Data API](/api/mongodb) for full reference.

| Endpoint | Description |
|----------|-------------|
| `GET /v1/mongo/:workspaceId/collections/:col/documents` | Query documents |
| `POST /v1/mongo/:workspaceId/collections/:col/documents` | Insert documents |
| `PATCH /v1/mongo/:workspaceId/collections/:col/documents/:id` | Update document |
| `DELETE /v1/mongo/:workspaceId/collections/:col/documents/:id` | Delete document |
| `POST /v1/mongo/:workspaceId/collections/:col/aggregate` | Aggregation pipeline |
| `POST /v1/mongo/:workspaceId/collections/:col/bulk` | Bulk operations |

---

### Events

#### `POST /v1/events/:workspaceId/publish`
Publish a custom event to Kafka.

```json
{
  "topic": "user.actions",
  "key": "usr_123",
  "payload": {
    "action": "checkout_completed",
    "amount": 198.95
  }
}
```

---

### Functions (Serverless)

#### `POST /v1/functions/:workspaceId/actions`
Deploy a new serverless function.

#### `GET /v1/functions/:workspaceId/actions`
List deployed functions.

#### `POST /v1/functions/:workspaceId/actions/:name/invoke`
Invoke a function synchronously.

#### `DELETE /v1/functions/:workspaceId/actions/:name`
Remove a deployed function.

---

### Storage (S3)

#### `PUT /v1/storage/:workspaceId/objects/:path`
Upload an object.

#### `GET /v1/storage/:workspaceId/objects/:path`
Download an object.

#### `GET /v1/storage/:workspaceId/objects?prefix=...`
List objects with prefix filtering.

#### `DELETE /v1/storage/:workspaceId/objects/:path`
Delete an object.

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "Workspace wks_01HXXX not found",
    "correlationId": "corr-abc-123",
    "timestamp": "2024-01-15T10:00:00.000Z"
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `400` | Bad request (validation error) |
| `401` | Unauthorized (missing or invalid token) |
| `403` | Forbidden (insufficient scope/plan) |
| `404` | Resource not found |
| `409` | Conflict (duplicate, idempotency replay) |
| `422` | Unprocessable entity (business rule violation) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

### Idempotency Replay

When a request with an `Idempotency-Key` that was already processed is received, the original response is replayed with:

```
X-Idempotency-Replayed: true
```
