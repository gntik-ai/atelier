# Gateway & Routing

APISIX serves as the single entry point for all platform traffic, handling authentication, routing, rate limiting, and request validation.

## Architecture

```
External Traffic
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                 APISIX Gateway (port 9080)           │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              Plugin Pipeline                  │   │
│  │                                               │   │
│  │  1. CORS          → Origin/method validation  │   │
│  │  2. Rate Limit    → Profile-based throttling  │   │
│  │  3. OIDC          → JWT validation (Keycloak) │   │
│  │  4. Request Valid. → Headers, body size       │   │
│  │  5. Idempotency   → Replay protection        │   │
│  │  6. Correlation    → X-Correlation-Id mgmt    │   │
│  │  7. Claim Project. → JWT → HTTP headers       │   │
│  │  8. Proxy         → Route to upstream         │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Control Plane    Keycloak     Web Console
```

## Route Table

| Route Pattern | Priority | Upstream | Auth | Rate Profile |
|--------------|----------|----------|------|-------------|
| `/v1/platform/*` | 100 | Control Plane | Platform admin | `platform_control` |
| `/v1/tenants/*` | 100 | Control Plane | Platform admin | `tenant_control` |
| `/v1/workspaces/*` | 100 | Control Plane | Workspace scope | `workspace_control` |
| `/v1/auth/*` | 90 | Keycloak | Public / auth | `auth_control` |
| `/v1/iam/*` | 100 | Control Plane | Plan-gated | `platform_control` |
| `/v1/postgres/*` | 100 | Control Plane | Workspace scope | `workspace_control` |
| `/v1/mongo/*` | 100 | Control Plane | Workspace scope | `workspace_control` |
| `/v1/events/*` | 100 | Event Gateway | Workspace scope | `event_gateway` |
| `/v1/functions/*` | 100 | Control Plane | Workspace scope | `workspace_control` |
| `/v1/storage/*` | 100 | Control Plane | Workspace scope | `workspace_control` |
| `/realtime/*` | 80 | Control Plane | WebSocket auth | `realtime` |
| `/control-plane/*` | 100 | Control Plane | Platform admin | `platform_control` |
| `/auth/*` | 90 | Keycloak | Pass-through | `auth_control` |
| `/health` | 200 | Control Plane | None | — |
| `/*` | 10 | Web Console | None | — |

## OIDC Configuration

```yaml
oidc:
  discoveryUrl: http://keycloak:8080/realms/in-falcone-platform/.well-known/openid-configuration
  clientId: in-falcone-gateway
  clientType: bearer-only
  claimProjection:
    X-Auth-Subject: sub
    X-Auth-Tenant-Id: tenant_id
    X-Auth-Workspace-Id: workspace_id
    X-Auth-Plan-Id: plan_id
    X-Auth-Roles: realm_access.roles
    X-Auth-Scopes: scope
```

## CORS Policy

```yaml
cors:
  allowOrigins:
    - "https://console.{environment}.in-falcone.example.com"
  allowMethods:
    - GET, POST, PUT, PATCH, DELETE, OPTIONS
  allowHeaders:
    - Authorization
    - Content-Type
    - Idempotency-Key
    - X-API-Version
    - X-Correlation-Id
    - X-Auth-Subject
  allowCredentials: true
  maxAge: 3600
```

## Rate Limiting

Rates are enforced per-client (based on JWT subject):

| Profile | Requests/min | Burst | Window |
|---------|-------------|-------|--------|
| `platform_control` | 240 | 60 | 60s |
| `tenant_control` | 240 | 60 | 60s |
| `workspace_control` | 240 | 60 | 60s |
| `auth_control` | 180 | 40 | 60s |
| `provisioning` | 120 | 30 | 60s |
| `observability` | 300 | 80 | 60s |
| `event_gateway` | 600 | 150 | 60s |
| `realtime` | 120 | 30 | 60s |
| `native_admin` | 60 | 15 | 60s |

**Response when rate-limited:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 5
X-RateLimit-Limit: 240
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705312800
```

## Idempotency

Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) support idempotency via the `Idempotency-Key` header:

| Setting | Value |
|---------|-------|
| Key header | `Idempotency-Key` |
| TTL | 86400 seconds (24 hours) |
| Replay header | `X-Idempotency-Replayed: true` |
| Key format | Free-form string |

When a duplicate key is received within the TTL, the original response is replayed without re-executing the operation.

## Request Validation

### Required Headers

| Header | Pattern | Required On |
|--------|---------|------------|
| `X-API-Version` | Date format (e.g., `2024-01-01`) | All `/v1/*` requests |
| `X-Correlation-Id` | `^[A-Za-z0-9._:-]{8,128}$` | All requests (auto-generated if missing) |

### Body Size Limits

| Route Family | Max Body |
|-------------|----------|
| Default | 262 KB |
| Provisioning | 1 MB |
| Native admin | 512 KB |

### Spoofed Header Protection

The gateway **strips** any client-provided headers that match internal context headers:

- `X-Auth-Subject`
- `X-Auth-Tenant-Id`
- `X-Auth-Workspace-Id`
- `X-Auth-Plan-Id`
- `X-Auth-Roles`
- `X-Auth-Scopes`

These headers are only set by the gateway itself after JWT validation.

## Health Check

```
GET /health
```

No authentication required. Returns `200 OK` when the gateway is operational.

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```
