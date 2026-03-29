# Feature Specification: Console Endpoint Separation

**Feature Branch**: `069-console-endpoint-separation`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Separate SPA-consumed endpoints from backend-orchestrated workflow endpoints and internal platform-only endpoints for console operations."

**Backlog Traceability**:
- **Task**: US-UIB-01-T03
- **Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura
- **Epic**: EP-16 — Backend funcional de la consola
- **RFs covered by story**: RF-UIB-001, RF-UIB-002, RF-UIB-003, RF-UIB-004, RF-UIB-005
- **Story dependencies**: US-FN-03, US-UI-01, US-TEN-01
- **Task dependencies**: US-UIB-01-T01 (067-console-workflow-catalog — provides the authoritative workflow catalog used to distinguish backend-orchestrated endpoints), US-UIB-01-T02 (068-console-workflow-functions — provides the backend workflow functions that backend-orchestrated endpoints invoke)

**Compatibility note**: This feature depends on the workflow catalog produced by 067-console-workflow-catalog (US-UIB-01-T01) and the workflow functions specified by 068-console-workflow-functions (US-UIB-01-T02). It must not absorb sibling tasks US-UIB-01-T04 (saga/compensation patterns), US-UIB-01-T05 (audit and correlation-id), or US-UIB-01-T06 (E2E tests), which are specified and delivered independently. The scope is strictly the classification, routing, and access-control separation of endpoints — not the implementation of the workflows themselves nor of the audit/saga behavior layered on top of them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Console SPA interacts only with SPA-designated endpoints (Priority: P1)

As a console frontend developer, I want a clear, documented separation between endpoints the SPA is allowed to call directly and endpoints that exist only for backend orchestration or internal platform use, so that I never accidentally bypass server-side workflow execution by calling an internal endpoint directly from the browser.

**Why this priority**: This is the core value of the task. Without explicit separation, console developers may unknowingly call backend-only or platform-internal endpoints from the SPA, reintroducing the fragile client-side orchestration the workflow backend was designed to eliminate.

**Independent Test**: Enumerate all console-related endpoints and verify that each is classified as exactly one of: SPA-consumed, backend-orchestrated, or platform-internal. Attempt to call a backend-orchestrated endpoint and a platform-internal endpoint directly from the SPA and verify that both are rejected.

**Acceptance Scenarios**:

1. **Given** the console API surface is published, **When** a frontend developer reviews the available endpoints, **Then** every endpoint is labeled as one of three tiers: `spa`, `backend`, or `platform`, and no endpoint is unlabeled or dual-classified.
2. **Given** the SPA makes a request to a backend-orchestrated endpoint (e.g., an endpoint that triggers tenant provisioning), **When** the request arrives at the API gateway, **Then** the gateway rejects the request because the SPA consumer identity is not authorized for `backend`-tier endpoints.
3. **Given** the SPA makes a request to a platform-internal endpoint (e.g., an inter-service callback), **When** the request arrives at the API gateway, **Then** the gateway rejects the request because the SPA consumer identity is not authorized for `platform`-tier endpoints.
4. **Given** the SPA calls a `spa`-tier endpoint that triggers a complex multi-service operation (e.g., workspace creation), **When** the endpoint processes the request, **Then** the endpoint delegates to the corresponding backend workflow function rather than performing multi-service coordination itself.

---

### User Story 2 — Backend workflow functions invoke backend-tier endpoints without SPA exposure (Priority: P1)

As a platform engineer, I want backend-orchestrated endpoints to be callable only by authenticated backend workflow functions (OpenWhisk actions) and not by browser clients, so that multi-service mutations remain governed by server-side orchestration logic and cannot be triggered piecemeal from the browser.

**Why this priority**: Equal to Story 1 because the separation is meaningful only if enforced in both directions — the SPA cannot reach backend endpoints, and backend endpoints are genuinely available to workflow functions.

**Independent Test**: Invoke each backend-tier endpoint from an authenticated OpenWhisk workflow function and verify success. Then attempt the same invocation from a browser session token and verify rejection.

**Acceptance Scenarios**:

1. **Given** a backend workflow function (e.g., WF-CON-002 tenant provisioning) needs to call a backend-tier endpoint, **When** the function presents its service credential, **Then** the API gateway allows the request.
2. **Given** a browser session token is presented to the same backend-tier endpoint, **When** the request arrives at the API gateway, **Then** the gateway rejects it regardless of the user's role within their tenant.
3. **Given** a backend-tier endpoint performs a mutation on a platform service, **When** the mutation completes, **Then** it returns a result only to the calling workflow function and does not expose intermediate state to the SPA.

---

### User Story 3 — Platform-internal endpoints are isolated from both SPA and backend workflows (Priority: P2)

As a security reviewer, I want platform-internal endpoints (inter-service callbacks, health checks, provisioning hooks) to be unreachable from both the SPA and from general-purpose backend workflow functions, so that platform internals are never exposed to console actors.

**Why this priority**: Platform-internal isolation is a defense-in-depth layer. The primary risk is mitigated by Story 1 and Story 2, but a separate platform tier prevents lateral movement if a workflow function is compromised or misconfigured.

**Independent Test**: Attempt to call each platform-internal endpoint from an SPA session, from a workflow function service credential, and from a platform-internal service identity. Verify that only the platform-internal service identity succeeds.

**Acceptance Scenarios**:

1. **Given** a platform-internal endpoint exists (e.g., a Keycloak event callback or a Kafka consumer webhook), **When** a browser session token is presented, **Then** the API gateway rejects the request.
2. **Given** the same platform-internal endpoint, **When** a backend workflow function's service credential is presented, **Then** the API gateway rejects the request because the workflow function is not authorized for `platform`-tier access.
3. **Given** the same platform-internal endpoint, **When** a platform-internal service identity (e.g., an inter-service mutual-TLS certificate or internal-only API key) is presented, **Then** the request is allowed.

---

### User Story 4 — Endpoint classification derives from the workflow catalog (Priority: P2)

As a product owner, I want the endpoint classification to be traceable to the workflow catalog (067-console-workflow-catalog), so that every backend-tier endpoint corresponds to a cataloged workflow and every SPA-tier endpoint corresponds to an operation that the catalog explicitly excludes from backend workflows.

**Why this priority**: Traceability prevents classification drift. Without it, new endpoints may be arbitrarily assigned a tier, undermining the catalog's governance value.

**Independent Test**: For every backend-tier endpoint, verify that a corresponding workflow entry (WF-CON-*) exists in the catalog. For every SPA-tier endpoint, verify that the underlying operation does not meet any of the catalog's classification criteria (C-1 through C-5).

**Acceptance Scenarios**:

1. **Given** a new console endpoint is proposed, **When** it involves a multi-service mutation, credential handling, privilege escalation, asynchronous processing, or atomicity requirement, **Then** it is classified as `backend`-tier and must reference the corresponding catalog workflow entry (or trigger a catalog update if no entry exists yet).
2. **Given** a new console endpoint is proposed, **When** it involves only a single-service read or a single-service mutation without security or orchestration implications, **Then** it is classified as `spa`-tier and documented as a catalog exclusion.
3. **Given** a backend-tier endpoint exists without a corresponding catalog entry, **When** the endpoint classification is reviewed, **Then** the review flags it as non-compliant until either a catalog entry is added or the endpoint is reclassified.

---

### User Story 5 — Endpoint tier is discoverable via API metadata (Priority: P3)

As a console developer or integration engineer, I want each endpoint's tier classification to be discoverable through API documentation or metadata, so that consumers can programmatically determine which endpoints are available to them without trial and error.

**Why this priority**: Discoverability improves developer experience but is not strictly required for enforcement (which is handled at the gateway level). It can ship as a follow-up refinement.

**Independent Test**: Query the API documentation or metadata endpoint and verify that every console endpoint includes its tier classification (`spa`, `backend`, or `platform`) in the response.

**Acceptance Scenarios**:

1. **Given** the API documentation is generated or published, **When** a developer reviews a console endpoint, **Then** the endpoint metadata includes a `tier` field with one of: `spa`, `backend`, `platform`.
2. **Given** a developer filters the API catalog by tier, **When** they request only `spa`-tier endpoints, **Then** the result excludes all `backend` and `platform` endpoints.

---

### Edge Cases

- A console operation that currently qualifies as SPA-tier is later extended to coordinate multiple services (e.g., updating a user profile now also syncs to an external directory). The classification system must detect the change during review and require reclassification to backend-tier.
- A backend workflow function needs to call another backend-tier endpoint as part of a composed workflow. The service credential authorization must permit this chaining without exposing the inner endpoint to the SPA.
- A platform-internal endpoint is accidentally registered in the API gateway with a `spa`-tier route. The classification enforcement must catch this misconfiguration at deployment validation, not at runtime.
- A new endpoint is deployed without any tier classification. The system must treat unclassified endpoints as inaccessible to all consumer types until explicitly classified, following a deny-by-default policy.
- The SPA needs read-only visibility into the status of a long-running backend workflow (e.g., tenant provisioning status). The SPA-tier must include a status-query endpoint that returns execution state without exposing the backend-tier invocation endpoint.
- A workflow function's service credential is rotated. The backend-tier endpoint authorization must accept the new credential and reject the old one without a service interruption window that forces the SPA to compensate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST classify every console-related endpoint into exactly one of three tiers: `spa` (consumed directly by the browser SPA), `backend` (consumed only by backend workflow functions), or `platform` (consumed only by internal platform services). No endpoint may be unclassified or assigned to more than one tier.
- **FR-002**: The API gateway MUST enforce tier-based access control so that SPA consumer identities (browser session tokens) can access only `spa`-tier endpoints, backend workflow service credentials can access only `backend`-tier endpoints, and platform-internal service identities can access only `platform`-tier endpoints.
- **FR-003**: Endpoints that trigger operations classified as backend workflows in the catalog (WF-CON-001 through WF-CON-006 and future catalog entries) MUST be classified as `backend`-tier.
- **FR-004**: Endpoints that serve operations explicitly excluded from backend workflows by the catalog (single-service reads, single-service mutations without security or orchestration implications) MUST be classified as `spa`-tier.
- **FR-005**: Endpoints that serve inter-service communication, health checks, provisioning callbacks, or other platform infrastructure concerns MUST be classified as `platform`-tier.
- **FR-006**: Each `spa`-tier endpoint that corresponds to a complex multi-service operation MUST delegate to the appropriate backend workflow function rather than performing multi-service coordination itself. The SPA endpoint acts as a thin facade that accepts the user's request and returns the workflow's result or job reference.
- **FR-007**: The system MUST apply a deny-by-default policy: any endpoint deployed without an explicit tier classification MUST be inaccessible to all consumer types until classified.
- **FR-008**: Each backend-tier endpoint MUST be traceable to a specific workflow catalog entry (WF-CON-*). A backend-tier endpoint without a corresponding catalog entry is non-compliant and MUST be flagged during review.
- **FR-009**: The tier classification of each endpoint MUST be part of the endpoint's API metadata, discoverable through API documentation or a metadata query, so that consumers can determine which endpoints are available to them.
- **FR-010**: The system MUST support status-query endpoints at the `spa`-tier for long-running backend workflows (at minimum WF-CON-002 and WF-CON-003), allowing the SPA to check execution progress without having access to the backend-tier invocation endpoint.
- **FR-011**: Tier-based access control MUST respect tenant isolation: a valid SPA session for tenant A MUST NOT access `spa`-tier endpoints scoped to tenant B, and a backend workflow function executing on behalf of tenant A MUST NOT access `backend`-tier endpoints scoped to tenant B.

### Key Entities

- **Endpoint Tier**: A classification label (`spa`, `backend`, or `platform`) assigned to every console-related endpoint that determines which consumer types are authorized to call it.
- **SPA Consumer Identity**: The authentication credential (browser session token) used by the React console SPA to call endpoints. Authorized only for `spa`-tier access.
- **Backend Service Credential**: The authentication credential used by OpenWhisk workflow functions to call endpoints. Authorized only for `backend`-tier access.
- **Platform Service Identity**: The authentication credential used by internal platform services for inter-service communication. Authorized only for `platform`-tier access.
- **Facade Endpoint**: An `spa`-tier endpoint that accepts a user request for a complex operation and delegates to a backend workflow function, returning the workflow's result or job reference to the SPA.
- **Workflow Catalog Reference**: The link from a `backend`-tier endpoint to its corresponding workflow entry (WF-CON-*) in the 067-console-workflow-catalog, ensuring classification traceability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of console-related endpoints carry an explicit tier classification (`spa`, `backend`, or `platform`) — verified by enumerating all endpoints and confirming none are unclassified.
- **SC-002**: The SPA cannot successfully call any `backend`-tier or `platform`-tier endpoint — verified by attempting requests from a browser session to every non-`spa` endpoint and confirming all are rejected.
- **SC-003**: Backend workflow functions cannot successfully call any `platform`-tier endpoint — verified by attempting requests from a workflow service credential to every `platform`-tier endpoint and confirming rejection.
- **SC-004**: Every `backend`-tier endpoint has a traceable reference to a specific workflow catalog entry (WF-CON-*) — verified by cross-referencing the endpoint registry against the catalog.
- **SC-005**: Every `spa`-tier endpoint that corresponds to a cataloged workflow (WF-CON-001 through WF-CON-004, WF-CON-006) delegates to the backend workflow function rather than performing multi-service coordination — verified by tracing the call path of each such endpoint.
- **SC-006**: An endpoint deployed without a tier classification is inaccessible to all consumer types — verified by deploying an unclassified test endpoint and confirming that SPA, backend, and platform credentials all receive rejection.
- **SC-007**: The API documentation or metadata query includes tier classification for every console endpoint — verified by querying the API catalog and confirming the `tier` field is present and populated.
- **SC-008**: Tier-based access control enforces tenant isolation — verified by attempting cross-tenant access at the `spa` tier and the `backend` tier and confirming rejection in both cases.

## Assumptions

- The workflow catalog (067-console-workflow-catalog/catalog.md) is stable and its classification criteria (C-1 through C-5) and workflow entries (WF-CON-001 through WF-CON-006) are the authoritative source for distinguishing backend-orchestrated operations from SPA-direct operations.
- The backend workflow functions specified by 068-console-workflow-functions (US-UIB-01-T02) exist or will exist as callable OpenWhisk actions that the `spa`-tier facade endpoints can delegate to.
- Apache APISIX (the project's API gateway) supports route-level access control that can distinguish between SPA consumer identities, backend service credentials, and platform service identities — either natively or through its plugin system.
- The three consumer identity types (SPA session token, backend service credential, platform service identity) are already established or can be established through Keycloak configuration without requiring new identity infrastructure.
- Saga/compensation patterns (T04), audit/correlation-id behavior (T05), and E2E testing (T06) are out of scope. This spec does not define how failed workflows are compensated, how audit events are emitted, or how endpoint separation is validated end to end — those are sibling tasks.
- The deny-by-default policy for unclassified endpoints assumes the API gateway can be configured to reject requests to routes that lack a tier annotation. If the gateway does not support this natively, an admission-time validation step during deployment is an acceptable alternative.
