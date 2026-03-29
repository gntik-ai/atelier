# Implementation Plan: Console Endpoint Separation

**Spec**: `069-console-endpoint-separation/spec.md`  
**Task**: US-UIB-01-T03  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura  
**Epic**: EP-16 — Backend funcional de la consola  
**Catalog dependency**: `067-console-workflow-catalog/catalog.md` (v1.0.0)  
**Created**: 2026-03-29  
**Status**: Draft  

> **Scope boundary**: This plan covers T03 only — endpoint classification, APISIX access-control enforcement, facade endpoint design, deny-by-default policy, and API metadata. It does NOT include: saga/compensation (T04), audit/correlation-id (T05), E2E tests (T06), or backend workflow function implementation (T02).

---

## 1. Architectural Overview

### Three-Tier Consumer Model

```text
Browser SPA  ──── session JWT ──────► [ APISIX ] ──► spa-tier routes
OpenWhisk    ──── service credential ► [ APISIX ] ──► backend-tier routes
Platform svc ──── internal identity ─► [ APISIX ] ──► platform-tier routes
```

Every console-related route in APISIX carries exactly one `x-endpoint-tier` label (`spa`, `backend`, or `platform`). A consumer-restriction plugin bound to each route enforces that only the correct consumer group can call it. Routes without a label are blocked by a fallback deny plugin (deny-by-default).

### Key Components Touched

| Component | What changes |
|---|---|
| APISIX routes | New/updated routes with tier labels and consumer-restriction plugins |
| APISIX consumer groups | Three groups: `console-spa`, `console-backend`, `console-platform` |
| Keycloak | Service client for backend workflows; optional platform service identity |
| OpenWhisk | No new actions in T03; facade endpoints call existing T02 actions |
| Console API surface | New facade endpoints (`/console/v1/…`) and status-query endpoints |
| Helm values | Route/consumer configuration in `apisix-routes` chart |
| API docs | OpenAPI annotations with `x-endpoint-tier` extension |

---

## 2. Consumer Identity Design

### 2.1 SPA Consumer — `console-spa`

- **Credential type**: Keycloak-issued session JWT (OIDC `authorization_code` flow, short-lived).
- **APISIX plugin**: `openid-connect` (validates JWT against Keycloak JWKS endpoint) + `consumer-restriction` (allow only consumer group `console-spa`).
- **APISIX consumer definition**: Consumer `console-spa-user` with `openid-connect` credentials; added to group `console-spa`.
- **Tenant isolation**: The JWT's `tenant_id` claim is forwarded as a header; downstream routes validate the claim against the URL path parameter.

### 2.2 Backend Service Credential — `console-backend`

- **Credential type**: Keycloak client credentials (`client_credentials` grant) for the `console-workflow-service` service client. Long-lived with rotation support.
- **APISIX plugin**: `openid-connect` (validates service JWT) + `consumer-restriction` (allow only group `console-backend`).
- **APISIX consumer definition**: Consumer `console-workflow-service` with `openid-connect` credentials; added to group `console-backend`.
- **Tenant isolation**: Service credential carries a `on-behalf-of-tenant` claim populated by the calling OpenWhisk action; backend-tier routes validate this claim.

### 2.3 Platform Service Identity — `console-platform`

- **Credential type**: Internal-only API key (APISIX `key-auth`) OR mutual-TLS certificate (future). For this task: static key stored in Kubernetes Secret, injected at Helm deploy time.
- **APISIX plugin**: `key-auth` + `consumer-restriction` (allow only group `console-platform`).
- **APISIX consumer definition**: Consumer `console-platform-service` with `key-auth` credentials; added to group `console-platform`.
- **Rotation path**: Key stored in a Kubernetes Secret rotatable via Helm upgrade without service disruption (old key remains valid for one upgrade cycle via APISIX consumer update).

---

## 3. Endpoint Inventory and Classification

Classification derives directly from `catalog.md` (C-1 through C-5) per FR-003/FR-004/FR-005.

### 3.1 Backend-Tier Endpoints

These endpoints are callable **only** by `console-backend` consumers. They are the internal invocation surface for OpenWhisk workflow functions (T02).

| Endpoint | Method | Catalog Ref | Criteria Met |
|---|---|---|---|
| `/console/v1/internal/workflows/user-approval` | POST | WF-CON-001 | C-1, C-4 |
| `/console/v1/internal/workflows/tenant-provisioning` | POST | WF-CON-002 | C-1, C-3, C-4, C-5 |
| `/console/v1/internal/workflows/workspace-creation` | POST | WF-CON-003 | C-1, C-3, C-5 |
| `/console/v1/internal/workflows/credential-generation` | POST | WF-CON-004 | C-1, C-2, C-5 |
| `/console/v1/internal/workflows/multi-service` | POST | WF-CON-005 | C-1, C-5 |
| `/console/v1/internal/workflows/service-account-lifecycle` | POST | WF-CON-006 | C-2, C-4 |

> All paths under `/console/v1/internal/` are blocked to non-`console-backend` groups. Path prefix acts as a hard topological separator, not as the sole access-control mechanism.

### 3.2 SPA-Tier Endpoints

These endpoints are callable **only** by `console-spa` consumers (browser session JWT). Those that invoke complex operations are **facade endpoints** that delegate to backend workflow functions (FR-006).

#### 3.2.1 Facade Endpoints (delegate to backend workflows)

| Endpoint | Method | Delegates to | Catalog Ref |
|---|---|---|---|
| `/console/v1/tenants/{tenantId}/members/{userId}/approve` | POST | WF-CON-001 via OpenWhisk | WF-CON-001 |
| `/console/v1/tenants` | POST | WF-CON-002 via OpenWhisk | WF-CON-002 |
| `/console/v1/tenants/{tenantId}/workspaces` | POST | WF-CON-003 via OpenWhisk | WF-CON-003 |
| `/console/v1/tenants/{tenantId}/workspaces/{wsId}/credentials` | POST | WF-CON-004 via OpenWhisk | WF-CON-004 |
| `/console/v1/tenants/{tenantId}/service-accounts` | POST | WF-CON-006 via OpenWhisk | WF-CON-006 |

Each facade endpoint:
1. Accepts the user's JSON body.
2. Validates tenant claim in JWT matches path `tenantId`.
3. Invokes the corresponding OpenWhisk action (T02) with `service credential` via the OpenWhisk HTTP API.
4. Returns the workflow's immediate result or a `202 Accepted` with a `job_id` for async workflows.

#### 3.2.2 Status-Query Endpoints (FR-010)

Required for long-running workflows WF-CON-002 and WF-CON-003 (C-3 criterion):

| Endpoint | Method | Tracks |
|---|---|---|
| `/console/v1/tenants/{tenantId}/provisioning-status/{jobId}` | GET | WF-CON-002 job state |
| `/console/v1/tenants/{tenantId}/workspaces/{wsId}/creation-status/{jobId}` | GET | WF-CON-003 job state |

Status-query endpoints read job state from a PostgreSQL `console_workflow_jobs` table (written by T02 workflow functions). They do NOT expose backend-tier invocation endpoints.

#### 3.2.3 Direct SPA Endpoints (exclusion list — no delegation)

| Endpoint | Method | Catalog Exclusion |
|---|---|---|
| `/console/v1/tenants/{tenantId}/members` | GET | List workspace members |
| `/console/v1/tenants/{tenantId}/profile` | GET | Read user/tenant profile |
| `/console/v1/tenants/{tenantId}/profile` | PATCH | Update display name |
| `/console/v1/tenants/{tenantId}/functions/{fnId}/logs` | GET | Fetch execution logs |
| `/console/v1/tenants/{tenantId}/quotas` | GET | Check quota usage |

### 3.3 Platform-Tier Endpoints

Callable **only** by `console-platform` consumers (internal platform services).

| Endpoint | Method | Purpose |
|---|---|---|
| `/console/v1/platform/health` | GET | Liveness/readiness |
| `/console/v1/platform/callbacks/keycloak-events` | POST | Keycloak event hook |
| `/console/v1/platform/callbacks/provisioning-hook` | POST | Async provisioning completion callback |

---

## 4. APISIX Configuration Design

### 4.1 Consumer Groups

```yaml
# apisix/consumer-groups.yaml (rendered by Helm)
- id: console-spa
  desc: "Browser SPA session consumers"
- id: console-backend
  desc: "OpenWhisk workflow service credentials"
- id: console-platform
  desc: "Internal platform service identities"
```

### 4.2 Route Plugin Chain per Tier

**SPA-tier route template**:

```yaml
plugins:
  openid-connect:
    discovery: "${KEYCLOAK_OIDC_DISCOVERY_URL}"
    bearer_only: true
  consumer-restriction:
    whitelist: ["console-spa"]
  x-endpoint-tier: "spa"         # custom metadata label
```

**Backend-tier route template**:

```yaml
plugins:
  openid-connect:
    discovery: "${KEYCLOAK_OIDC_DISCOVERY_URL}"
    bearer_only: true
  consumer-restriction:
    whitelist: ["console-backend"]
  x-endpoint-tier: "backend"
```

**Platform-tier route template**:

```yaml
plugins:
  key-auth: {}
  consumer-restriction:
    whitelist: ["console-platform"]
  x-endpoint-tier: "platform"
```

### 4.3 Deny-by-Default (FR-007)

APISIX global rule (lowest priority, catches all unmatched routes under `/console/`):

```yaml
- id: console-deny-unclassified
  uri: /console/*
  priority: -999
  plugins:
    serverless-pre-function:
      phase: access
      functions:
        - "return function(conf, ctx) ngx.exit(403) end"
```

Any route that lacks a `consumer-restriction` plugin (unclassified) falls through to this global deny rule. This satisfies FR-007 without requiring per-route validation at deployment time alone.

### 4.4 Deployment Validation Hook

A CI/CD admission step (`scripts/validate-apisix-routes.mjs`) checks before deployment:
1. Every route under `/console/` has `x-endpoint-tier` set.
2. Every `backend`-tier route has a corresponding `WF-CON-*` catalog reference in its `desc` field.
3. No route is dual-classified.

Fails the deployment pipeline on violation.

---

## 5. Facade Endpoint Implementation

### 5.1 Code Location

```text
src/
  console-api/
    routes/
      spa/
        tenant-provisioning.facade.mjs    ← POST /console/v1/tenants
        workspace-creation.facade.mjs     ← POST /console/v1/tenants/:tenantId/workspaces
        user-approval.facade.mjs          ← POST /console/v1/.../approve
        credential-generation.facade.mjs  ← POST /console/v1/.../credentials
        service-account.facade.mjs        ← POST /console/v1/.../service-accounts
      spa/status/
        provisioning-status.mjs           ← GET  /console/v1/.../provisioning-status/:jobId
        workspace-creation-status.mjs     ← GET  /console/v1/.../creation-status/:jobId
      platform/
        health.mjs
        keycloak-events.mjs
        provisioning-hook.mjs
```

### 5.2 Facade Contract

Each facade follows this pattern:

```javascript
// Example: tenant provisioning facade
export async function handler(req, res) {
  // 1. Extract and validate tenant claim from JWT vs path
  const tenantId = req.params.tenantId;
  const jwtTenantId = req.auth.tenant_id;
  if (tenantId !== jwtTenantId) return res.status(403).json({ error: 'tenant_mismatch' });

  // 2. Invoke OpenWhisk action (T02 function)
  const result = await owClient.invoke('console/tenant-provisioning', {
    tenantId,
    payload: req.body,
    correlationId: req.headers['x-request-id'] ?? crypto.randomUUID(),
  });

  // 3. Return job reference for async workflows
  if (result.async) {
    return res.status(202).json({ jobId: result.activationId, status: 'accepted' });
  }
  return res.status(200).json(result.response);
}
```

### 5.3 OpenWhisk Client Module

```text
src/
  lib/
    openwhisk-client.mjs    ← thin wrapper, uses OPENWHISK_API_KEY + OPENWHISK_API_URL from env
```

Credentials (`OPENWHISK_API_KEY`, `OPENWHISK_API_URL`) are injected via Kubernetes Secret and mounted as environment variables in the console-api pod. They are NOT exposed to the SPA.

---

## 6. Job Status Data Model

A lightweight `console_workflow_jobs` table (PostgreSQL) tracks async workflow state:

```sql
CREATE TABLE console_workflow_jobs (
  job_id          UUID PRIMARY KEY,
  workflow_id     VARCHAR(16) NOT NULL,  -- WF-CON-NNN
  tenant_id       UUID NOT NULL,
  activation_id   VARCHAR(128),          -- OpenWhisk activation ID
  status          VARCHAR(32) NOT NULL DEFAULT 'accepted',
    -- accepted | running | succeeded | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  result          JSONB,
  error           JSONB
);

CREATE INDEX idx_cwj_tenant ON console_workflow_jobs(tenant_id);
```

- T02 workflow functions write to this table (their concern).
- T03 status-query endpoints read from it (this task's concern).
- T05 audit/correlation-id columns are NOT added here (out of scope for T03).

**Migration file**: `db/migrations/0069-console-workflow-jobs.sql`

---

## 7. API Metadata and Discoverability (FR-009)

### 7.1 OpenAPI Extension

Each console endpoint in the OpenAPI spec (`openapi/console-api.json`) carries:

```json
"x-endpoint-tier": "spa",
"x-catalog-ref": "WF-CON-002"
```

`x-catalog-ref` is required for `backend`-tier and optional for `spa`-tier facade endpoints (to show delegation target).

### 7.2 Tier Filter Query

A metadata endpoint at the SPA tier exposes the filtered catalog:

```text
GET /console/v1/meta/endpoints?tier=spa
```

Response:

```json
{
  "tier": "spa",
  "endpoints": [
    { "path": "/console/v1/tenants", "method": "POST", "tier": "spa", "catalogRef": "WF-CON-002" },
    ...
  ]
}
```

This endpoint is itself `spa`-tier (SC-007).

---

## 8. Tenant Isolation Design (FR-011)

### SPA-tier

- APISIX `openid-connect` plugin forwards the `tenant_id` JWT claim as `X-Tenant-Id` header.
- Facade handlers validate `X-Tenant-Id` against the `{tenantId}` URL path parameter. Mismatch → 403.
- Status-query endpoints filter `console_workflow_jobs` by `tenant_id` from the JWT, never from a user-supplied body parameter.

### Backend-tier

- OpenWhisk action invocations include an `on-behalf-of-tenant` field populated from the calling facade's validated `tenantId`.
- Backend-tier endpoints validate the `on-behalf-of-tenant` claim in the service JWT. Mismatch → 403.

---

## 9. Implementation Artifacts Summary

| Artifact | Path | Type |
|---|---|---|
| APISIX consumer group definitions | `helm/apisix-routes/values/consumers.yaml` | Config |
| APISIX route definitions (spa/backend/platform) | `helm/apisix-routes/values/console-routes.yaml` | Config |
| Global deny rule | `helm/apisix-routes/values/deny-unclassified.yaml` | Config |
| Facade endpoint handlers | `src/console-api/routes/spa/*.facade.mjs` | Code |
| Status-query handlers | `src/console-api/routes/spa/status/*.mjs` | Code |
| Platform endpoint handlers | `src/console-api/routes/platform/*.mjs` | Code |
| OpenWhisk client module | `src/lib/openwhisk-client.mjs` | Code |
| DB migration | `db/migrations/0069-console-workflow-jobs.sql` | Migration |
| OpenAPI spec (annotated) | `openapi/console-api.json` | Contract |
| Tier metadata endpoint | `src/console-api/routes/spa/meta/endpoints.mjs` | Code |
| Route validation script | `scripts/validate-apisix-routes.mjs` | CI script |
| Unit tests | `tests/console-api/routes/spa/*.test.mjs` | Tests |
| Integration tests | `tests/integration/endpoint-tier-enforcement.test.mjs` | Tests |

---

## 10. Test Strategy

### 10.1 Unit Tests (`node:test`, ESM)

- **Facade logic**: Mock OpenWhisk client; verify tenant claim validation, correct action invocation, 202 vs 200 branching.
- **Status query**: Mock PostgreSQL; verify tenant-scoped filtering, 404 on missing job, 403 on cross-tenant access.
- **Route validation script**: Verify it rejects routes without `x-endpoint-tier`, routes without catalog refs on backend tier, and dual-classified routes.

### 10.2 Integration Tests

- Start a local APISIX instance (Docker Compose in CI) with the rendered Helm routes.
- **SPA-tier enforcement**: Call each `backend`-tier and `platform`-tier endpoint with a valid SPA session JWT → expect 403.
- **Backend-tier enforcement**: Call each `spa`-tier endpoint with a service credential JWT → expect 403.
- **Platform-tier enforcement**: Call each `platform`-tier endpoint with SPA JWT and with backend service credential → expect 403 for both.
- **Deny-by-default**: Deploy an unclassified test route → call with any consumer identity → expect 403.
- **Tenant isolation**: Call a `spa`-tier endpoint with `tenantId` in path != JWT claim → expect 403.
- **Facade delegation**: Call a facade endpoint → verify the correct OpenWhisk action was invoked (mock OpenWhisk in test).
- **Status query**: Insert a job row for tenant A; call status endpoint with tenant B session → expect 403.

### 10.3 Contract Tests

- Validate `openapi/console-api.json` against JSON Schema for OpenAPI 3.1.
- Assert every path object contains `x-endpoint-tier` (custom lint rule).
- Assert every `backend`-tier path contains `x-catalog-ref` referencing a valid `WF-CON-*` ID.

### 10.4 Out of Scope for T03

- E2E tests with real OpenWhisk and real tenant data → T06.
- Saga/compensation test scenarios → T04.
- Audit event emission verification → T05.

---

## 11. Implementation Sequence

Incremental, dependency-respecting order:

1. **Step 1 — Consumer groups and route skeleton** (no logic yet)  
   Define APISIX consumer groups (`console-spa`, `console-backend`, `console-platform`) and the global deny-unclassified rule. Deploy to dev. Validate deny-by-default works for all routes.

2. **Step 2 — DB migration**  
   Apply `0069-console-workflow-jobs.sql`. Verify table exists in dev PostgreSQL.

3. **Step 3 — Backend-tier routes**  
   Define APISIX routes for `/console/v1/internal/workflows/*` with `console-backend` consumer restriction. Write contract test. Validate backend identity can call, SPA cannot.

4. **Step 4 — Platform-tier routes**  
   Define APISIX routes for `/console/v1/platform/*` with `console-platform` consumer restriction. Write contract test.

5. **Step 5 — OpenWhisk client module**  
   Implement `src/lib/openwhisk-client.mjs`. Unit-test with mock responses.

6. **Step 6 — Facade endpoints (SPA-tier, delegating)**  
   Implement facade handlers. Wire APISIX `spa`-tier routes. Unit-test tenant claim validation and OpenWhisk delegation.

7. **Step 7 — Status-query endpoints**  
   Implement status handlers. Unit-test PostgreSQL filtering.

8. **Step 8 — Direct SPA endpoints** (exclusion list operations)  
   Wire existing or new route handlers for reads. Confirm `spa`-tier restriction.

9. **Step 9 — API metadata endpoint and OpenAPI annotations**  
   Annotate OpenAPI spec with `x-endpoint-tier` and `x-catalog-ref`. Implement `/meta/endpoints`. Run contract linter.

10. **Step 10 — Route validation CI script**  
    Implement `validate-apisix-routes.mjs`. Integrate into CI pipeline. Break build on violation.

11. **Step 11 — Integration test suite**  
    Wire full integration tests against local APISIX Docker Compose setup. All scenarios from §10.2 pass.

---

## 12. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| T02 OpenWhisk actions not yet callable at T03 implementation time | Medium | Medium | Facade endpoints can be implemented with a stub/mock response mode (feature-flagged); integration tests mock the OpenWhisk API |
| APISIX `consumer-restriction` plugin behavior differs from expected (group vs. consumer-level) | Low | High | Prototype consumer group enforcement in Step 1 before building facade logic |
| `console_workflow_jobs` table not written by T02 in time for status-query tests | Medium | Low | Status-query endpoints can be integrated independently by seeding test rows; T02 dependency documented |
| Keycloak `client_credentials` grant for `console-workflow-service` not yet configured | Medium | Medium | Create Keycloak service client as part of Step 3; document credential injection via Helm `secretKeyRef` |
| OpenAPI `x-endpoint-tier` custom extension not supported by documentation tooling | Low | Low | Custom extension is additive; standard tooling still renders the spec; tier field also exposed via `/meta/endpoints` |
| Platform-tier mTLS requirement surfaces as a future hard blocker | Low | Medium | T03 uses static API key as the initial platform identity mechanism; mTLS migration tracked as a separate item |

---

## 13. Done Criteria (SC-001 through SC-008)

| Criterion | Evidence Required |
|---|---|
| SC-001: 100% endpoints classified | `validate-apisix-routes.mjs` exits 0; all routes carry `x-endpoint-tier` |
| SC-002: SPA cannot reach `backend` or `platform` | Integration tests: all non-`spa` endpoints return 403 to SPA JWT |
| SC-003: Backend cannot reach `platform` | Integration tests: all `platform` endpoints return 403 to service credential |
| SC-004: Every `backend` endpoint traces to catalog | `validate-apisix-routes.mjs` checks `x-catalog-ref` presence and validity against `WF-CON-*` IDs |
| SC-005: SPA facade endpoints delegate to workflow functions | Unit tests verify `owClient.invoke` called with correct action name; no multi-service logic in facade handler itself |
| SC-006: Unclassified endpoint inaccessible | Integration test deploys unclassified route; SPA + backend + platform credentials all receive 403 |
| SC-007: API metadata includes tier on all endpoints | Contract test asserts `x-endpoint-tier` present on every path in `openapi/console-api.json`; `/meta/endpoints` returns tier field |
| SC-008: Tenant isolation enforced at both tiers | Integration test: cross-tenant SPA call returns 403; cross-tenant backend credential call returns 403 |

---

## 14. Out-of-Scope Reminders

The following are explicitly NOT part of this plan:

- Saga/compensation logic on failure paths (T04).
- Audit event emission, correlation-id propagation (T05).
- End-to-end workflow validation with real multi-service failures (T06).
- OpenWhisk action implementation for the backend workflows themselves (T02).
- Any UI component changes beyond what the console React app needs to call the new SPA-tier endpoints (UI changes are T01/T02 concern; this task defines the endpoint surface, not the UI components that consume it).
