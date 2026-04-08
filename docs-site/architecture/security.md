# Security & Authentication

In Falcone implements defense-in-depth security across all layers: network, identity, authorization, data isolation, and audit.

## Authentication

### Keycloak Integration

In Falcone uses **Keycloak 26.1** as its identity provider with a multi-realm architecture:

```
Keycloak
├── in-falcone-platform (platform realm)
│   ├── Clients
│   │   ├── in-falcone-gateway (bearer-only, for APISIX)
│   │   └── in-falcone-console (public SPA)
│   ├── Roles
│   │   ├── superadmin
│   │   ├── platform_admin
│   │   ├── platform_operator
│   │   ├── tenant_admin
│   │   ├── tenant_operator
│   │   ├── workspace_admin
│   │   └── workspace_operator
│   └── Client Scopes
│       ├── tenant-context
│       ├── workspace-context
│       ├── plan-context
│       └── workspace-roles
│
└── tenant-{tenantSlug} (per-tenant realm)
    ├── Workspace clients: {workspaceSlug}-{appSlug}
    └── Service accounts: {workspaceSlug}-svc-{saSlug}
```

### Token Flow

```
Client → Keycloak → JWT Token → APISIX → Control Plane
           │                       │
           │                       ├── Validate signature (JWKS)
           │                       ├── Check expiration
           │                       └── Project claims to headers:
           │                           X-Auth-Tenant-Id
           │                           X-Auth-Workspace-Id
           │                           X-Auth-Plan-Id
           │                           X-Auth-Roles
           │                           X-Auth-Scopes
           │
           └── Platform realm: password / client_credentials grant
               Tenant realm: password / authorization_code / client_credentials
```

### Supported OAuth 2.0 Flows

| Flow | Use Case | Client Type |
|------|----------|------------|
| **Authorization Code + PKCE** | Web console, SPAs | Public |
| **Client Credentials** | Service accounts, backends | Confidential |
| **Password** | Development / testing only | Public |

## Authorization

### Contextual Authorization Model

Authorization is **context-aware** — permissions depend on the tenant, workspace, and plan of the request:

```
Request
  │
  ├── Platform Context
  │   └── Role: superadmin, platform_admin, platform_operator
  │
  ├── Tenant Context
  │   └── Role: tenant_admin, tenant_operator
  │   └── Scope: tenant-context (claim: tenant_id)
  │
  └── Workspace Context
      └── Role: workspace_admin, workspace_operator
      └── Scope: workspace-context (claim: workspace_id)
      └── Plan capabilities checked
```

### Scope Enforcement

The APISIX gateway enforces scopes at the routing level:

1. **Claim Projection**: JWT claims are projected into HTTP headers
2. **Spoofed Header Protection**: Context headers from external sources are stripped
3. **Scope Matching**: Route requires matching scope (e.g., `/v1/workspaces/{id}/postgres` requires `workspace-context`)
4. **Plan Capability Gating**: Routes like `/v1/iam/*` require specific plan capabilities

### Row-Level Security (PostgreSQL)

Every tenant's data is protected by RLS policies:

```sql
-- Context functions
CREATE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT current_setting('app.tenant_id', TRUE)
$$ LANGUAGE sql STABLE;

-- RLS policy on shared tables
CREATE POLICY tenant_isolation ON workspaces
  USING (tenant_id = current_tenant_id());
```

The runtime connection sets the tenant context before every query:
```sql
SET LOCAL app.tenant_id = 'tnt_01HXXX';
SET LOCAL app.workspace_id = 'wks_01HXXX';
```

### Role Separation (PostgreSQL)

| Role | Permissions | Use Case |
|------|------------|----------|
| `platform_runtime` | SELECT, INSERT, UPDATE, DELETE (with RLS) | Normal API operations |
| `platform_migrator` | CREATE, ALTER, DROP (DDL) | Schema migrations |
| `platform_provisioner` | CREATE SCHEMA, GRANT | Tenant provisioning |
| `platform_audit_readonly` | SELECT on audit tables | Audit queries |
| `platform_break_glass` | Superuser (emergency only) | Break-glass access |

## Gateway Security

### APISIX Plugins

| Plugin | Purpose |
|--------|---------|
| **OIDC** | JWT validation against Keycloak JWKS |
| **Rate Limiting** | Per-profile request throttling |
| **CORS** | Origin, method, header enforcement |
| **Request Validation** | Required headers, body size limits |
| **Idempotency** | Replay protection (24h TTL) |
| **Correlation** | X-Correlation-Id propagation |

### Rate Limiting Profiles

| Profile | Rate | Burst | Applies To |
|---------|------|-------|------------|
| `platform_control` | 240/min | 60 | Platform admin APIs |
| `tenant_control` | 240/min | 60 | Tenant management |
| `workspace_control` | 240/min | 60 | Workspace management |
| `auth_control` | 180/min | 40 | Authentication endpoints |
| `provisioning` | 120/min | 30 | Provisioning operations |
| `observability` | 300/min | 80 | Metrics and health |
| `event_gateway` | 600/min | 150 | Event publishing |
| `realtime` | 120/min | 30 | WebSocket connections |

### Request Validation

| Check | Default | Notes |
|-------|---------|-------|
| **Required Headers** | `X-API-Version`, `X-Correlation-Id` | All API requests |
| **Max Body Size** | 262 KB | 1 MB for provisioning, 512 KB for admin |
| **Idempotency-Key** | Optional | Required for mutating operations |
| **Spoofed Headers** | Stripped | `X-Auth-*` headers from clients rejected |

## Secret Management

### Architecture

```
Vault (Source of Truth)
  │
  ├── Platform secrets (Keycloak admin, DB credentials, etc.)
  ├── Tenant secrets (per-tenant credentials)
  └── Workspace secrets (per-workspace API keys)
  │
  ▼
External Secrets Operator (ESO)
  │
  ├── ClusterSecretStore → Vault connection
  └── ExternalSecret → Kubernetes Secret
      │
      └── Pod (envFrom / volumeMount)
```

### Secret Resolution Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `kubernetesSecret` | Rendered as `secretKeyRef` | Default for all components |
| `env` | Pre-injected pod environment variable | External injection |
| `externalRef` | External secret manager metadata | Cloud secret managers |

### Vault Policies

| Policy | Scope | Access |
|--------|-------|--------|
| `platform-policy` | `secret/data/platform/*` | Read/write platform secrets |
| `tenant-policy` | `secret/data/tenant/*` | Read/write tenant secrets |
| `gateway-policy` | `secret/data/gateway/*` | Read gateway credentials |
| `functions-policy` | `secret/data/functions/*` | Read function secrets |
| `iam-policy` | `secret/data/iam/*` | Read IAM credentials |

## Pod Security

All pods run with restricted security contexts:

```yaml
podSecurityContext:
  runAsNonRoot: true
  fsGroup: 1001
  seccompProfile:
    type: RuntimeDefault
  fsGroupChangePolicy: OnRootMismatch

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true    # Stateless components
  capabilities:
    drop: [ALL]
```

### Compliance

| Standard | Status |
|----------|--------|
| Kubernetes Pod Security Standards (Restricted) | Compliant |
| OpenShift restricted-v2 SCC | Compliant |
| Non-root containers | All components |
| Read-only root filesystem | Stateless components |
| No privilege escalation | All containers |
| Dropped capabilities | All containers |

## Audit Trail

Every operation is audit-logged:

```json
{
  "eventId": "evt_01HXXX",
  "correlationId": "corr-abc-123",
  "timestamp": "2024-01-15T10:00:00.000Z",
  "actor": {
    "type": "user",
    "id": "usr_01HXXX",
    "roles": ["platform_admin"]
  },
  "resource": {
    "type": "workspace",
    "id": "wks_01HXXX",
    "tenantId": "tnt_01HXXX"
  },
  "action": "workspace.create",
  "outcome": "success",
  "metadata": { ... }
}
```

Audit events flow through Kafka topics and are stored in PostgreSQL for querying and compliance export.
