# Services & Components

Detailed description of every service and application in the In Falcone platform.

## Applications

### Control Plane (`apps/control-plane/`)

The **central API service** that exposes the platform's REST surface.

| Property | Value |
|----------|-------|
| Runtime | Node.js 20+ ESM |
| Port | 8080 |
| Package | `@in-falcone/control-plane` |

**Responsibilities:**
- Exposes `/v1/*` public API families (tenants, workspaces, auth, IAM, etc.)
- Delegates lifecycle operations to the provisioning orchestrator
- Enforces contextual authorization (tenant/workspace scope)
- Serves OpenAPI documentation at `/control-plane/openapi`
- Emits audit events for every mutating operation

**Key Dependencies:**
- `@in-falcone/internal-contracts` — Shared schemas
- `@in-falcone/adapters` — Provider adapters
- `@in-falcone/provisioning-orchestrator` — Lifecycle logic
- PostgreSQL, Keycloak, Kafka

---

### Web Console (`apps/web-console/`)

The **management dashboard** for platform operators and tenant administrators.

| Property | Value |
|----------|-------|
| Runtime | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Port | 3000 |
| Package | `@in-falcone/web-console` |

**Features:**
- Tenant and workspace management
- Database browsing (PostgreSQL tables, MongoDB collections)
- Function deployment and invocation
- Audit log viewer
- Health and metrics dashboards
- Keycloak-based authentication (OIDC)

**Configuration:**
- Auth realm: `in-falcone-platform`
- Auth client: `in-falcone-console` (public SPA)
- All settings configurable via `VITE_CONSOLE_*` environment variables

---

## Core Services

### Adapters (`services/adapters/`)

The **provider abstraction layer** that normalizes access to all infrastructure components.

| Package | `@in-falcone/adapters` |
|---------|----------------------|

**Adapter Modules:**

| Module | Provider | Operations |
|--------|----------|------------|
| `keycloak-admin.mjs` | Keycloak 26.1 | Realm, client, role, user management |
| `openwhisk-admin.mjs` | OpenWhisk 2.0 | Namespace, action, package, trigger management |
| `postgres-admin.mjs` | PostgreSQL 17.2 | Schema, table, RLS policy management |
| `mongodb-admin.mjs` | MongoDB 8.0 | Database, collection, index management |
| `kafka-admin.mjs` | Kafka 3.9 | Topic, ACL, consumer group management |
| `storage-admin.mjs` | MinIO S3 | Bucket, object, lifecycle management |

**Key Design Decisions:**
- Reserved realm IDs: `master`, `in-falcone-platform` (protected from tenant operations)
- All operations are idempotent and return normalized results
- Audit envelopes emitted at the adapter boundary
- Supports both internal and external provider bindings

---

### Internal Contracts (`services/internal-contracts/`)

**Machine-readable JSON schemas** that define the platform's behavioral contracts.

| Package | `@in-falcone/internal-contracts` |
|---------|--------------------------------|

**Contract Categories:**

| Schema | Purpose |
|--------|---------|
| `domain-model.json` | Core entity definitions (tenant, workspace, app, etc.) |
| `deployment-topology.json` | Helm values structure, bootstrap payloads, environment profiles |
| `authorization-model.json` | Contextual authorization rules and scope enforcement |
| `internal-service-map.json` | Service dependency graph and allowed interactions |
| `public-api-taxonomy.json` | API route families and versioning rules |
| `observability-*.json` | Metrics, dashboards, health checks, alerts, audit pipeline |

These contracts are:
- Validated by CI scripts in `scripts/`
- Used as source of truth for code generation
- Referenced by all services for consistent behavior

---

### Provisioning Orchestrator (`services/provisioning-orchestrator/`)

**Manages the lifecycle** of tenants, workspaces, and managed resources.

| Package | `@in-falcone/provisioning-orchestrator` |
|---------|---------------------------------------|

**Operations:**
- **Tenant creation**: Keycloak realm, PostgreSQL schema, MongoDB database, Kafka topics
- **Workspace creation**: Scoped resources within a tenant
- **Plan assignment**: Quota enforcement and capability activation
- **Configuration export/import**: Cross-environment migration
- **Preflight validation**: Verify deployment compatibility
- **Reprovisioning**: Reconcile configuration drift

**Workflow Pattern:**
```
Request → Validate → Collect current state → Plan changes →
  Apply (per-adapter) → Emit audit → Return result
```

---

### Gateway Config (`services/gateway-config/`)

**APISIX gateway route definitions** and scope enforcement rules.

**Key Files:**
- `base/gateway.yaml` — Core gateway configuration
- `base/public-api-routing.yaml` — API route family definitions
- `tests/plugins/` — Lua-based scope enforcement tests

**Route Families:**
| Prefix | Target | Auth |
|--------|--------|------|
| `/v1/platform/*` | Control Plane | Platform admin |
| `/v1/tenants/*` | Control Plane | Platform admin |
| `/v1/workspaces/*` | Control Plane | Tenant/workspace scope |
| `/v1/auth/*` | Keycloak | Public / authenticated |
| `/v1/iam/*` | Control Plane | Plan-capability-gated |
| `/v1/postgres/*` | Control Plane | Workspace scope |
| `/v1/mongo/*` | Control Plane | Workspace scope |
| `/v1/events/*` | Event Gateway | Workspace scope |
| `/v1/functions/*` | Control Plane | Workspace scope |
| `/v1/storage/*` | Control Plane | Workspace scope |

---

### Event Gateway (`services/event-gateway/`)

**Kafka event publishing bridge** that connects workspace operations to the event streaming layer.

| Package | `@in-falcone/event-gateway` |
|---------|---------------------------|

**Features:**
- Authenticated event publishing per workspace
- Topic routing based on event type
- Kafka integration with configurable brokers
- Correlation ID propagation
- Audit event emission

---

### Realtime Gateway (`services/realtime-gateway/`)

**WebSocket subscription server** for realtime event delivery.

**Features:**
- Keycloak JWT authentication (JWKS validation)
- Channel-based subscriptions (PostgreSQL, MongoDB, custom)
- Operation filtering (INSERT, UPDATE, DELETE)
- Kafka-backed event consumption
- Audit topics: `console.realtime.auth-granted`, `auth-denied`, `session-suspended`, `session-resumed`

---

### Audit Service (`services/audit/`)

**Audit event processing pipeline** that consumes events from Kafka and stores them.

| Package | `@in-falcone/audit` |
|---------|-------------------|

**Features:**
- Kafka consumer for audit topics
- Correlation surface for cross-service tracing
- Query surface for audit log retrieval
- Export surface for compliance reporting
- Normalized event schema with actor, resource, action, outcome

---

### CDC Bridges

#### PostgreSQL CDC Bridge (`services/pg-cdc-bridge/`)

Captures PostgreSQL WAL changes and publishes them to Kafka.

| Property | Value |
|----------|-------|
| Image | `falcone/pg-cdc-bridge:1.0.0` |
| Port | 8080 |
| Kafka Topic | `console.pg-capture.lifecycle` |

**Configuration:**
- WAL monitoring with configurable thresholds
- CDC cache with TTL (30s default)
- Max events per second: 1000

#### MongoDB CDC Bridge (`services/mongo-cdc-bridge/`)

Captures MongoDB change stream events and publishes them to Kafka.

---

### Backup Status (`services/backup-status/`)

**Backup monitoring and restoration** service.

| Package | `@in-falcone/backup-status` |
|---------|---------------------------|

**Features:**
- Backup collection tracking across all subsystems
- Restore confirmation with MFA verification
- Pre-check validation before restoration
- Operational hours enforcement
- Adapter-based backup collection (PostgreSQL, MongoDB, S3, Keycloak)

---

### Secret Audit Handler (`services/secret-audit-handler/`)

Tracks and audits all secret access operations in the Vault + ESO pipeline.

---

## Infrastructure Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **APISIX** | Apache APISIX 3.10 | API Gateway (routing, auth, rate limiting) |
| **Keycloak** | Keycloak 26.1 | Identity and Access Management |
| **PostgreSQL** | PostgreSQL 17.2 | Primary relational database |
| **MongoDB** | MongoDB 8.0 | Document database |
| **Kafka** | Apache Kafka 3.9 | Event streaming and audit |
| **OpenWhisk** | Apache OpenWhisk 2.0 | Serverless function runtime |
| **MinIO** | MinIO 2026.3 | S3-compatible object storage |
| **Vault** | HashiCorp Vault OSS | Secret management |
| **ESO** | External Secrets Operator | Kubernetes secret synchronization |
| **Prometheus** | Prometheus 3.2 | Metrics collection and alerting |
