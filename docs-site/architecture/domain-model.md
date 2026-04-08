# Domain Model

In Falcone's core domain model defines six primary entities organized in a hierarchical relationship.

## Entity Hierarchy

```
Platform
│
├── Platform User (usr_<ulid>)
│   └── Platform-level operator / administrator
│
└── Tenant (tnt_<ulid>)
    │
    ├── Workspace (wks_<ulid>)
    │   │
    │   ├── External Application (app_<ulid>)
    │   │   └── Client app registered for OAuth 2.0
    │   │
    │   ├── Service Account (svc_<ulid>)
    │   │   └── Machine identity for API access
    │   │
    │   └── Managed Resource (res_<ulid>)
    │       └── Database, function, bucket, topic, etc.
    │
    └── Tenant Plan Assignment
        └── starter | growth | regulated | enterprise
```

## Entities

### Platform User

Represents a human operator of the In Falcone platform.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `usr_<ulid>` | Unique identifier |
| `slug` | `string` | URL-safe human-readable name |
| `email` | `string` | Contact email |
| `roles` | `string[]` | Platform roles (superadmin, platform_admin, etc.) |
| `status` | `enum` | `pending`, `active`, `suspended`, `deactivated` |
| `createdAt` | `timestamptz` | Creation timestamp |
| `updatedAt` | `timestamptz` | Last modification |

**Roles:**
- `superadmin` — Full platform access
- `platform_admin` — Tenant and user management
- `platform_operator` — Read-only platform monitoring

---

### Tenant

An organization or customer that owns resources on the platform.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `tnt_<ulid>` | Unique identifier |
| `slug` | `string` | URL-safe organization name |
| `displayName` | `string` | Human-readable name |
| `plan` | `string` | Governance plan (starter, growth, regulated, enterprise) |
| `iamContext` | `enum` | `realm_per_tenant`, `realm_per_partition`, `brokered` |
| `status` | `enum` | `provisioning`, `active`, `suspended`, `deactivated` |
| `metadata` | `jsonb` | Custom metadata |
| `createdAt` | `timestamptz` | Creation timestamp |
| `updatedAt` | `timestamptz` | Last modification |

**Lifecycle:**
```
provisioning → active → suspended → deactivated
                 │                       ▲
                 └── suspended ──────────┘
                       │
                       └── active (reactivation)
```

When a tenant is deactivated, all child workspaces are soft-deleted.

---

### Workspace

An isolated environment within a tenant. Each workspace gets its own:
- PostgreSQL schema (or dedicated database)
- MongoDB database
- Kafka topic namespace
- OpenWhisk namespace
- S3 bucket path

| Field | Type | Description |
|-------|------|-------------|
| `id` | `wks_<ulid>` | Unique identifier |
| `tenantId` | `tnt_<ulid>` | Parent tenant |
| `slug` | `string` | URL-safe workspace name |
| `displayName` | `string` | Human-readable name |
| `capabilities` | `string[]` | Enabled capabilities |
| `deploymentProfile` | `string` | Infrastructure topology |
| `status` | `enum` | `provisioning`, `active`, `suspended`, `deactivated` |
| `createdAt` | `timestamptz` | Creation timestamp |

**Available Capabilities:**
| Capability | Description |
|-----------|-------------|
| `identity` | Keycloak realm and client management |
| `postgres` | PostgreSQL schema with RLS |
| `mongo` | MongoDB database with partitioning |
| `kafka` | Kafka topics for event streaming |
| `storage` | S3-compatible object storage |
| `functions` | OpenWhisk serverless runtime |
| `observability` | Prometheus metrics and dashboards |
| `audit` | Audit logging and compliance |

---

### External Application

A client application registered for OAuth 2.0 access to a workspace.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `app_<ulid>` | Unique identifier |
| `workspaceId` | `wks_<ulid>` | Parent workspace |
| `slug` | `string` | Application name |
| `redirectUris` | `string[]` | OAuth 2.0 redirect URIs |
| `allowedOrigins` | `string[]` | CORS allowed origins |
| `grantTypes` | `string[]` | OAuth 2.0 grant types |
| `status` | `enum` | `active`, `suspended`, `revoked` |

Keycloak client pattern: `{workspaceSlug}-{applicationSlug}`

---

### Service Account

A machine identity for programmatic API access within a workspace.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `svc_<ulid>` | Unique identifier |
| `workspaceId` | `wks_<ulid>` | Parent workspace |
| `slug` | `string` | Service account name |
| `scopes` | `string[]` | Granted API scopes |
| `status` | `enum` | `active`, `suspended`, `revoked` |

Keycloak pattern: `{workspaceSlug}-svc-{serviceAccountSlug}`

**Authentication:** Client credentials grant → JWT with workspace-scoped claims.

---

### Managed Resource

A provisioned resource within a workspace (database table, function, bucket, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `res_<ulid>` | Unique identifier |
| `workspaceId` | `wks_<ulid>` | Parent workspace |
| `kind` | `string` | Resource type (postgres_table, mongo_collection, function, bucket...) |
| `name` | `string` | Resource name |
| `status` | `enum` | `provisioning`, `active`, `deleting`, `deleted` |
| `metadata` | `jsonb` | Resource-specific configuration |

## Plans & Governance

### Plan Hierarchy

| Plan | Target | Max Workspaces | Deployment Profile |
|------|--------|---------------|-------------------|
| **Starter** | Small teams | 3 | `shared-starter` |
| **Growth** | Growing businesses | 10 | `shared-growth` |
| **Regulated** | Compliance needs | 25 | `regulated-dedicated` |
| **Enterprise** | Large organizations | Unlimited | `enterprise-federated` |

### Quota Dimensions

Each plan defines soft and hard limits per dimension:

| Dimension | Starter | Growth | Regulated | Enterprise |
|-----------|---------|--------|-----------|------------|
| Workspaces | 3 | 10 | 25 | Unlimited |
| PostgreSQL tables | 20 | 100 | 500 | Unlimited |
| MongoDB collections | 10 | 50 | 200 | Unlimited |
| Functions | 5 | 25 | 100 | Unlimited |
| Storage (GB) | 5 | 50 | 500 | Unlimited |
| API calls/month | 50K | 500K | 5M | Unlimited |

### Deployment Profiles

| Profile | Description |
|---------|-------------|
| `shared-starter` | Shared infra, minimal resources |
| `shared-growth` | Shared infra, moderate resources |
| `regulated-dedicated` | Dedicated database, enhanced isolation |
| `enterprise-federated` | Federated identity, dedicated resources |

## ID Format

All entity IDs follow the pattern `<prefix>_<ulid>`:

| Entity | Prefix | Example |
|--------|--------|---------|
| Platform User | `usr_` | `usr_01HXXXXXXXXXXXXXXXXXX` |
| Tenant | `tnt_` | `tnt_01HXXXXXXXXXXXXXXXXXX` |
| Workspace | `wks_` | `wks_01HXXXXXXXXXXXXXXXXXX` |
| Application | `app_` | `app_01HXXXXXXXXXXXXXXXXXX` |
| Service Account | `svc_` | `svc_01HXXXXXXXXXXXXXXXXXX` |
| Managed Resource | `res_` | `res_01HXXXXXXXXXXXXXXXXXX` |

ULIDs are time-sortable, globally unique, and URL-safe.
