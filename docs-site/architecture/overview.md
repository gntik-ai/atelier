# Architecture Overview

In Falcone is a modular, multi-tenant Backend-as-a-Service platform built as a monorepo with clear service boundaries, declarative configuration, and Kubernetes-native deployment.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Public Surface                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ API      │  │ Console  │  │ Identity │  │ Realtime           │  │
│  │ (APISIX) │  │ (React)  │  │ (KC)     │  │ (WebSocket)        │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬───────────────┘  │
└───────┼──────────────┼──────────────┼──────────────┼────────────────┘
        │              │              │              │
┌───────▼──────────────▼──────────────▼──────────────▼────────────────┐
│                      APISIX API Gateway                             │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  OIDC  │ │  Rate  │ │  CORS    │ │ Request  │ │ Idempotency  │  │
│  │  Auth  │ │ Limit  │ │  Policy  │ │ Validate │ │   Cache      │  │
│  └────────┘ └────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│                     Application Layer                               │
│                                                                     │
│  ┌────────────────────┐    ┌──────────────────────────────────────┐ │
│  │    Control Plane    │    │    Provisioning Orchestrator        │ │
│  │    (Node.js API)    │───▶│    (Lifecycle Management)           │ │
│  └────────────────────┘    └──────────────┬───────────────────────┘ │
│                                           │                         │
│  ┌──────────────┐  ┌──────────────┐       │  ┌──────────────────┐  │
│  │ Event        │  │ Realtime     │       │  │ Audit            │  │
│  │ Gateway      │  │ Gateway      │       │  │ Service          │  │
│  └──────────────┘  └──────────────┘       │  └──────────────────┘  │
│                                           │                         │
│  ┌────────────────────────────────────────▼───────────────────────┐ │
│  │                   Provider Adapters                            │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │ │
│  │  │Keycloak │ │Postgres │ │MongoDB  │ │ Kafka   │ │OpenWhisk│ │ │
│  │  │Adapter  │ │Adapter  │ │Adapter  │ │Adapter  │ │Adapter │ │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │ │
│  └───────┼──────────┼──────────┼──────────┼──────────┼─────────┘ │
└──────────┼──────────┼──────────┼──────────┼──────────┼───────────┘
           │          │          │          │          │
┌──────────▼──────────▼──────────▼──────────▼──────────▼───────────┐
│                    Infrastructure Layer                           │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │Keycloak  │ │PostgreSQL│ │ MongoDB  │ │  Kafka   │            │
│  │ 26.1     │ │  17.2    │ │   8.0    │ │   3.9    │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │OpenWhisk │ │  MinIO   │ │Prometheus│ │  Vault   │            │
│  │  2.0     │ │ Storage  │ │   3.2    │ │  + ESO   │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

## Design Principles

### 1. Multi-Tenancy First

Every layer of the platform is designed for multi-tenancy:

- **Identity**: Keycloak platform realm + per-tenant realms
- **Data**: Schema-per-tenant isolation in PostgreSQL, partitioned MongoDB
- **Compute**: Namespace-scoped OpenWhisk actions
- **Network**: Tenant-scoped API routing with OIDC claim projection
- **Observability**: Metric scoping with `tenant_id` labels

### 2. Declarative Configuration

The entire platform state is described in Helm values:
- Component topology and replicas
- APISIX routes and gateway policies
- Keycloak realms, clients, and roles
- Governance catalog (plans, quotas, capabilities)
- Bootstrap controller payloads

### 3. Provider Abstraction

Infrastructure providers (PostgreSQL, MongoDB, Keycloak, etc.) are accessed through an **adapter layer** that:
- Normalizes operations into a contract-driven interface
- Enables swapping providers without changing the control plane
- Provides audit logging at the adapter boundary
- Supports both internal and external provider bindings

### 4. Separation of Concerns

```
Control Plane  →  Provisioning Orchestrator  →  Audit  →  Adapters
(API surface)     (lifecycle logic)             (events)   (providers)
```

Dependencies flow forward only. The control plane never talks directly to infrastructure providers — it delegates to the orchestrator, which uses adapters.

### 5. Kubernetes-Native

- Helm umbrella chart with reusable component-wrapper subchart
- Pod security standards (non-root, read-only FS, restricted SCC)
- ConfigMap/Secret-based configuration injection
- Multi-platform exposure (Ingress, Route, LoadBalancer)
- Idempotent bootstrap job with lock mechanism

## Data Flow

### Request Lifecycle

```
Client Request
    │
    ▼
APISIX Gateway
    ├── OIDC token validation (Keycloak)
    ├── Rate limit check
    ├── Request validation (headers, body size)
    ├── CORS enforcement
    ├── Idempotency check
    └── Claim projection (tenant_id, workspace_id → headers)
    │
    ▼
Control Plane
    ├── Authorization check (contextual, scope-based)
    ├── Business logic
    └── Delegate to orchestrator/adapter
    │
    ▼
Provider Adapter
    ├── Execute operation (SQL, MongoDB command, etc.)
    ├── Emit audit event → Kafka
    └── Return result
    │
    ▼
Audit Pipeline
    ├── Kafka consumer
    ├── Correlation tracking
    ├── Audit storage (PostgreSQL)
    └── Observable metrics (Prometheus)
```

### Event Flow

```
Data Change (PG/Mongo)
    │
    ▼
CDC Bridge (WAL/Change Stream)
    │
    ▼
Kafka Topic
    ├── Audit consumer → Audit storage
    ├── Realtime Gateway → WebSocket subscribers
    └── Custom consumers → External systems
```

## Monorepo Structure

| Directory | Purpose |
|-----------|---------|
| `apps/control-plane/` | Platform REST API (Node.js 20+ ESM) |
| `apps/web-console/` | Management UI (React 18 + Vite + Tailwind) |
| `services/adapters/` | Provider adapters for all infrastructure |
| `services/internal-contracts/` | Machine-readable JSON schemas |
| `services/provisioning-orchestrator/` | Tenant/workspace lifecycle management |
| `services/gateway-config/` | APISIX route definitions and tests |
| `services/event-gateway/` | Event publishing bridge to Kafka |
| `services/realtime-gateway/` | WebSocket subscription server |
| `services/audit/` | Audit event processing pipeline |
| `services/backup-status/` | Backup monitoring and restoration |
| `services/pg-cdc-bridge/` | PostgreSQL Change Data Capture |
| `services/mongo-cdc-bridge/` | MongoDB Change Data Capture |
| `services/secret-audit-handler/` | Secret access audit trail |
| `charts/in-falcone/` | Umbrella Helm chart |
| `charts/realtime-gateway/` | Realtime gateway Helm chart |
| `tests/` | E2E and security hardening tests |
| `scripts/` | Validation and generation scripts |
| `docs/` | Internal ADRs and references |

## Next

- [Services & Components](/architecture/services) — Detailed service descriptions
- [Domain Model](/architecture/domain-model) — Core entity model
- [Security & Auth](/architecture/security) — Authentication and authorization design
- [Deployment Topology](/architecture/deployment) — Kubernetes deployment architecture
