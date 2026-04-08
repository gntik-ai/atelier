# What is In Falcone?

**In Falcone** is an open-source, self-hosted **Backend-as-a-Service (BaaS)** platform that provides managed data, identity, serverless functions, event streaming, and object storage — all within a multi-tenant architecture designed for production workloads on Kubernetes and OpenShift.

## The Problem

Building a multi-tenant backend platform from scratch requires integrating dozens of components: databases, identity providers, API gateways, event brokers, object storage, observability stacks, and more. Each component needs tenant isolation, security hardening, audit logging, and operational tooling.

## The Solution

In Falcone bundles these components into a cohesive, declaratively configured platform:

- **One Helm chart** deploys the entire stack with layered configuration
- **One API gateway** routes all traffic with authentication, rate limiting, and validation
- **One identity provider** manages platform and tenant authentication
- **One control plane** orchestrates tenant/workspace lifecycle
- **One audit pipeline** tracks every operation across all subsystems

## Key Concepts

### Platform Hierarchy

In Falcone organizes resources in a four-level hierarchy:

```
Platform
└── Tenant (organization / customer)
    └── Workspace (isolated environment)
        ├── External Application (client app)
        ├── Service Account (machine identity)
        └── Managed Resource (database, function, bucket...)
```

### Tenants

A **tenant** represents an organization or customer. Each tenant:
- Has its own Keycloak realm (or shares the platform realm depending on IAM topology)
- Owns one or more workspaces
- Is assigned a governance plan (starter, growth, regulated, enterprise)
- Has quota limits enforced by the platform

### Workspaces

A **workspace** is an isolated environment within a tenant. It provides:
- Dedicated PostgreSQL schema (shared database) or dedicated database (enterprise tier)
- MongoDB database with automatic tenant partitioning
- Kafka topics for event streaming
- OpenWhisk namespace for serverless functions
- S3 bucket paths for object storage
- Realtime subscription channels

### Plans & Governance

The platform enforces governance through **plans** that define:
- **Quota dimensions**: max workspaces, databases, functions, storage, API calls
- **Capability flags**: which features are available (identity, postgres, mongo, kafka, storage, observability, audit)
- **Deployment profiles**: infrastructure topology (shared-starter, shared-growth, regulated-dedicated, enterprise-federated)

## Architecture at a Glance

```
                    ┌─────────────────────────────┐
                    │        APISIX Gateway        │
                    │  (auth, routing, rate limit)  │
                    └──────┬──────────┬────────────┘
                           │          │
              ┌────────────┘          └────────────┐
              ▼                                    ▼
   ┌──────────────────┐                ┌───────────────────┐
   │   Control Plane   │                │   Web Console     │
   │   (Node.js API)   │                │   (React 18 SPA)  │
   └────────┬─────────┘                └───────────────────┘
            │
   ┌────────┼──────────────────────────────────────┐
   │        ▼                                      │
   │  Provisioning Orchestrator                    │
   │  ┌──────────┬──────────┬──────────┬────────┐  │
   │  │ Keycloak │ Postgres │ MongoDB  │ Kafka  │  │
   │  │ Adapter  │ Adapter  │ Adapter  │Adapter │  │
   │  └──────────┴──────────┴──────────┴────────┘  │
   └───────────────────────────────────────────────┘
            │           │          │          │
   ┌────────▼──┐ ┌──────▼──┐ ┌────▼────┐ ┌──▼─────┐
   │ Keycloak  │ │Postgres │ │ MongoDB │ │ Kafka  │
   │ 26.1      │ │ 17.2    │ │ 8.0     │ │ 3.9    │
   └───────────┘ └─────────┘ └─────────┘ └────────┘
         │
   ┌─────▼──────┐  ┌───────────┐  ┌───────────┐
   │ OpenWhisk  │  │   MinIO   │  │ Prometheus │
   │ 2.0        │  │  Storage  │  │  Metrics   │
   └────────────┘  └───────────┘  └───────────┘
         │
   ┌─────▼──────────────────────────┐
   │  Vault + External Secrets      │
   │  (secret management)           │
   └────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Language** | Node.js (ESM) | 20+ |
| **Frontend** | React + TypeScript + Tailwind + shadcn/ui | 18 |
| **Build** | Vite | Latest |
| **Package Manager** | pnpm (workspaces) | 10+ |
| **API Gateway** | Apache APISIX | 3.10.0 |
| **Identity** | Keycloak | 26.1.0 |
| **Relational DB** | PostgreSQL | 17.2.0 |
| **Document DB** | MongoDB | 8.0.0 |
| **Event Broker** | Apache Kafka | 3.9.0 |
| **Serverless** | Apache OpenWhisk | 2.0.0 |
| **Object Storage** | MinIO | 2026.3.23 |
| **Secrets** | HashiCorp Vault OSS + ESO | Latest |
| **Metrics** | Prometheus | 3.2.1 |
| **Deployment** | Helm 3 on Kubernetes / OpenShift | Latest |

## What's Next?

- [Installation](/guide/installation) — Full installation guide for all environments
- [Quickstart](/guide/quickstart) — Get running in 5 minutes
- [Architecture Overview](/architecture/overview) — Deep dive into the system design
