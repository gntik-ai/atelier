---
layout: home
hero:
  name: In Falcone
  text: Multi-Tenant Backend-as-a-Service
  tagline: Deploy a complete, production-ready BaaS platform on Kubernetes or OpenShift in minutes.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quickstart
    - theme: alt
      text: View Architecture
      link: /architecture/overview
    - theme: alt
      text: GitHub
      link: https://github.com/gntik-ai/falcone

features:
  - icon: 🏗️
    title: Multi-Tenant by Design
    details: Hierarchical isolation model with platform users, tenants, workspaces, and managed resources. Hybrid PostgreSQL isolation with schema-per-tenant and dedicated-database escalation.
  - icon: 🔌
    title: Unified Data APIs
    details: REST APIs for PostgreSQL (SQL-like CRUD with RLS) and MongoDB (document operations, aggregations, change streams) — all tenant-scoped and audit-logged.
  - icon: ⚡
    title: Realtime Subscriptions
    details: WebSocket-based realtime event delivery with Keycloak authentication, Kafka-backed audit trails, and fine-grained channel filtering.
  - icon: 🔐
    title: Enterprise Security
    details: Keycloak IAM with platform and tenant realms, Vault + ESO secret management, APISIX gateway with OIDC, rate limiting, CORS, and idempotency.
  - icon: ☸️
    title: Kubernetes & OpenShift Native
    details: Helm umbrella chart with layered values, deployment profiles (all-in-one, standard, HA), air-gap support, and multi-platform exposure (Ingress, Route, LoadBalancer).
  - icon: 🔭
    title: Built-in Observability
    details: Prometheus metrics, multi-tenant dashboards, health checks, quota enforcement, threshold alerts, and a complete audit pipeline with correlation tracking.
---

## Quick Overview

In Falcone is a modular, multi-tenant **Backend-as-a-Service** platform designed for teams that need managed data, identity, serverless functions, and event streaming — all deployed on your own infrastructure.

### Core Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Control Plane** | Node.js 20+ ESM | Platform API and orchestration |
| **Web Console** | React 18 + Vite | Management dashboard |
| **API Gateway** | Apache APISIX 3.10 | Routing, auth, rate limiting |
| **Identity** | Keycloak 26.1 | IAM, OAuth 2.0, multi-tenant realms |
| **Primary Database** | PostgreSQL 17.2 | Relational data with tenant isolation |
| **Document Store** | MongoDB 8.0 | Document data with partitioning |
| **Event Streaming** | Kafka 3.9 | Event bus and audit pipeline |
| **Serverless** | Apache OpenWhisk 2.0 | Function execution runtime |
| **Object Storage** | MinIO 2026.3 | S3-compatible blob storage |
| **Secrets** | Vault OSS + ESO | Encrypted secret management |
| **Metrics** | Prometheus 3.2 | Observability and alerting |

### Monorepo Structure

```
falcone/
├── apps/
│   ├── control-plane/        # Platform API backend
│   └── web-console/          # React management UI
├── services/
│   ├── adapters/             # Provider adapters (Keycloak, OW, PG, Mongo...)
│   ├── internal-contracts/   # Machine-readable schemas & contracts
│   ├── provisioning-orchestrator/  # Tenant/workspace lifecycle
│   ├── gateway-config/       # APISIX routing definitions
│   ├── event-gateway/        # Event publishing bridge
│   ├── realtime-gateway/     # WebSocket subscription server
│   ├── audit/                # Audit event processing
│   ├── backup-status/        # Backup monitoring service
│   ├── pg-cdc-bridge/        # PostgreSQL Change Data Capture
│   ├── mongo-cdc-bridge/     # MongoDB Change Data Capture
│   └── ...
├── charts/
│   └── in-falcone/           # Umbrella Helm chart
├── docs/                     # Internal docs & ADRs
├── tests/                    # E2E and hardening tests
└── scripts/                  # Validation & generation scripts
```
