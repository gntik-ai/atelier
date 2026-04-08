# Architecture Decision Records

In Falcone maintains Architecture Decision Records (ADRs) to document significant design choices and their rationale.

## Index

| ADR | Title | Status | Summary |
|-----|-------|--------|---------|
| [ADR-0001](#adr-0001) | Monorepo Bootstrap | Accepted | pnpm workspace with apps/, services/, charts/, docs/, tests/ |
| [ADR-0002](#adr-0002) | PostgreSQL Tenant Isolation | Accepted | Hybrid shared-schema + dedicated-database model |
| [ADR-0003](#adr-0003) | Control Plane Service Map | Accepted | Split into control API → orchestration → audit → adapters |
| [ADR-0004](#adr-0004) | Public Domain Environment Topology | Accepted | Environment-scoped domains for API, console, identity, realtime |
| [ADR-0005](#adr-0005) | Contextual Authorization Model | Accepted | Scope-based authorization with tenant/workspace context |
| [ADR-0006](#adr-0006) | Core Domain Entity Model | Accepted | Six entities: user, tenant, workspace, app, service account, resource |
| [ADR-0007](#adr-0007) | Membership Plan Governance | Accepted | Plans with quota dimensions and capability flags |
| [ADR-0008](#adr-0008) | Public API Route Families | Accepted | /v1/* route families with stable prefixes |
| [ADR-0009](#adr-0009) | Keycloak Platform and Tenant IAM | Accepted | Platform realm + per-tenant realms with workspace clients |
| ADR-E2E-001 | Fault Injection Mechanism | Accepted | E2E fault injection for compensation testing |

---

## ADR-0001: Monorepo Bootstrap {#adr-0001}

**Decision:** Organize the platform as a pnpm monorepo.

**Structure:**
- `apps/` — Deployable applications (control-plane, web-console)
- `services/` — Reusable packages, adapters, orchestrators
- `charts/` — Helm packaging and deployment
- `docs/` — Internal documentation and ADRs
- `tests/e2e/` — Black-box end-to-end validation

**Rationale:** A monorepo enables atomic cross-package changes, shared tooling, and a single CI pipeline. Lightweight structural validation can run before functional code exists.

---

## ADR-0002: PostgreSQL Tenant Isolation {#adr-0002}

**Decision:** Implement a hybrid tenant isolation model.

**Default mode:** Shared database with schema-per-tenant + Row-Level Security on shared tables.

**Escalation path:** Dedicated database per tenant for regulated/enterprise plans.

**Drivers:**
- Isolation strength proportional to plan tier
- Economic viability (shared infra for small tenants)
- Operability (single cluster to manage)
- Reversibility (can promote without data loss)
- Auditability (all access through RLS)

**Guardrails:**
- Placement metadata tracks which database hosts which tenant
- Role separation: runtime role ≠ DDL role ≠ provisioner role
- Mandatory RLS on all shared-schema tables
- Observability per tenant schema

---

## ADR-0003: Control Plane Service Map {#adr-0003}

**Decision:** Split the control plane into four bounded contexts with forward-only dependencies.

```
control_api → provisioning_orchestrator → audit_module → adapter_ports
```

**Contracts between boundaries:**
- `idempotency_key` — Deduplication at every boundary
- `contract_version` — Schema versioning for inter-service calls
- `retryable` / `terminal` — Result classification for retry logic
- `audit_envelope` — Structured audit payloads at adapter boundary

---

## ADR-0005: Contextual Authorization {#adr-0005}

**Decision:** Authorization is context-aware, not just role-based.

A request's permissions depend on:
1. **Who** — The authenticated user/service account
2. **Where** — The tenant and workspace context from JWT claims
3. **What** — The resource type and operation
4. **Plan** — The tenant's plan capabilities

This model prevents cross-tenant access even if roles match, and gates features based on plan capabilities.

---

## ADR-0006: Core Domain Entity Model {#adr-0006}

**Decision:** Define six core entities with shared baseline conventions.

| Entity | ID Format | Lifecycle States |
|--------|-----------|-----------------|
| Platform User | `usr_<ulid>` | pending → active → suspended → deactivated |
| Tenant | `tnt_<ulid>` | provisioning → active → suspended → deactivated |
| Workspace | `wks_<ulid>` | provisioning → active → suspended → deactivated |
| External Application | `app_<ulid>` | active → suspended → revoked |
| Service Account | `svc_<ulid>` | active → suspended → revoked |
| Managed Resource | `res_<ulid>` | provisioning → active → deleting → deleted |

**Shared baseline:** All entities have `id`, `slug`, `status`, `createdAt`, `updatedAt`. ULIDs provide time-sortable, globally unique IDs.

---

## ADR-0009: Keycloak IAM Architecture {#adr-0009}

**Decision:** Use a platform realm + per-tenant realm architecture.

**Platform realm (`in-falcone-platform`):**
- Console operators and platform admins
- Gateway client (bearer-only)
- Console client (public SPA)
- Platform-level roles and scopes

**Per-tenant realms (`tenant-{slug}`):**
- Tenant-specific users and identity providers
- Workspace clients for external applications
- Service accounts for machine identity
- Three IAM contexts: realm_per_tenant, realm_per_partition, brokered

**Automatic provisioning:** Tenant activation triggers Keycloak realm creation via the provisioning orchestrator.

---

## Adding New ADRs

ADRs follow the naming convention `NNNN-descriptive-title.md` and are stored in `docs/adr/`. Each ADR should include:

1. **Context** — Why this decision was needed
2. **Decision** — What was decided
3. **Consequences** — Positive and negative trade-offs
4. **Status** — Proposed, Accepted, Deprecated, Superseded
