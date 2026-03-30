# Feature Specification: Realtime E2E Test Suite — Subscription, Reconnection & Tenant/Workspace Isolation

**Feature Branch**: `084-realtime-e2e-test-suite`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Crear pruebas E2E de suscripción, reconexión y aislamiento de eventos por tenant/workspace"  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T06  
**Dependencies**: US-DX-01-T01 (channel/subscription model), US-DX-01-T02 (PG→Kafka capture), US-DX-01-T03 (Mongo→Kafka capture), US-DX-01-T04 (auth, scopes & filters), US-DX-01-T05 (SDK snippets & examples)

---

## Objective & Problem Statement

Tasks T01 through T05 have built the complete realtime pipeline: a channel/subscription model, change-data-capture bridges from PostgreSQL and MongoDB into Kafka, an authorization/scope/filter layer, and developer-facing SDK snippets. **However, there is no systematic end-to-end verification that the pipeline works correctly across its most critical dimensions: subscription lifecycle, reconnection resilience, and multi-tenant/workspace isolation.**

Without an E2E test suite:

- Regressions in tenant isolation could go undetected, allowing cross-tenant event leakage — the most severe class of defect in a multi-tenant system.
- Reconnection and token-refresh scenarios are exercised only manually (if at all), leaving reliability gaps in the developer experience.
- Subscription lifecycle edge cases (create, pause, resume, revoke, filter changes) lack automated coverage, meaning changes to upstream components (Kafka topology, IAM policies, CDC bridges) could silently break realtime delivery.
- The platform cannot confidently ship realtime features to production without manual regression testing, slowing release velocity.

This task specifies an **end-to-end test suite** that exercises the entire realtime pipeline from an external consumer's perspective — authenticating, subscribing, receiving events, reconnecting, and verifying that isolation boundaries hold — to provide automated confidence that the realtime capability is production-ready.

---

## Users & Consumers

| Actor | Value Received |
|-------|---------------|
| Platform engineering team | Automated regression safety net for the realtime pipeline; faster, safer releases |
| QA / test engineers | Reproducible, scriptable test scenarios that replace manual multi-tenant testing |
| Developer (external) | Indirect: higher reliability and correctness of the realtime API they consume |
| Tenant owner | Indirect: assurance that their data never leaks to another tenant's subscribers |
| Workspace admin | Indirect: confidence that workspace-scoped subscriptions respect boundaries |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Subscription lifecycle E2E verification (Priority: P1)

A QA engineer needs to verify that the full subscription lifecycle works end-to-end: a developer authenticates, creates a subscription on a workspace channel, triggers a data change in the corresponding data source (PostgreSQL table or MongoDB collection), and receives the expected event on the subscription. The test also covers subscription deletion and confirms that events stop arriving after removal.

**Why this priority**: This is the foundational happy-path that validates the entire T01–T05 pipeline is connected and functional. If this fails, nothing else matters.

**Independent Test**: Can be fully tested by provisioning a tenant and workspace, authenticating a user, creating a subscription, inserting a row/document, and asserting event delivery within a bounded time window.

**Acceptance Scenarios**:

1. **Given** a provisioned tenant with a workspace containing a PostgreSQL table, **When** an authenticated developer creates a subscription for INSERT events on that table and a row is inserted, **Then** the subscriber receives exactly one event within 10 seconds containing the correct operation type, table name, and payload summary.
2. **Given** a provisioned tenant with a workspace containing a MongoDB collection, **When** an authenticated developer creates a subscription for INSERT events on that collection and a document is inserted, **Then** the subscriber receives exactly one event within 10 seconds containing the correct operation type, collection name, and payload summary.
3. **Given** an active subscription delivering events, **When** the developer deletes the subscription and a new data change occurs, **Then** no further events are delivered on the deleted subscription.
4. **Given** a subscription with a filter for UPDATE operations only, **When** INSERT and UPDATE operations both occur, **Then** only the UPDATE event is delivered to the subscriber.

---

### User Story 2 — Reconnection and token-refresh resilience (Priority: P1)

A QA engineer needs to verify that the realtime pipeline handles connection interruptions gracefully: when a client's connection drops and they reconnect (with a valid or refreshed token), their subscription resumes delivering events without duplication or loss beyond a documented tolerance window.

**Why this priority**: Reconnection reliability is essential for developer trust. A subscription that silently loses events after a network hiccup makes the entire realtime feature unreliable for production use.

**Independent Test**: Can be tested by establishing a subscription, forcing a connection drop, reconnecting with a refreshed token, and asserting that events produced during the disconnection window are delivered upon reconnection (or that the documented behavior — e.g., replay from last acknowledged offset — is observed).

**Acceptance Scenarios**:

1. **Given** an active realtime subscription receiving events, **When** the client connection is severed (simulated network interruption) and the client reconnects within the allowed reconnection window using a valid token, **Then** the subscription resumes and events produced during the disconnection period are delivered (at-least-once semantics within the replay window).
2. **Given** an active realtime subscription, **When** the client's token expires during the session and the client performs a token refresh without full disconnection, **Then** event delivery continues uninterrupted and no events are lost or duplicated.
3. **Given** an active realtime subscription, **When** the client disconnects and reconnects with an expired or revoked token, **Then** the reconnection attempt is rejected with a structured authentication error and no events are delivered.
4. **Given** an active realtime subscription, **When** the client disconnects and does NOT reconnect within the allowed reconnection window, **Then** the subscription is automatically suspended by the platform and no events are buffered indefinitely.

---

### User Story 3 — Tenant isolation verification (Priority: P1)

A QA engineer needs to prove that events from one tenant's data sources are never delivered to a subscriber authenticated under a different tenant, regardless of subscription configuration, channel naming, or filter expressions.

**Why this priority**: Cross-tenant data leakage is the highest-severity defect category in a multi-tenant platform. This must be tested with adversarial scenarios, not just happy-path isolation.

**Independent Test**: Can be tested by provisioning two independent tenants (A and B), creating subscriptions in both, producing data changes in tenant A, and asserting that tenant B's subscriber receives zero events from tenant A.

**Acceptance Scenarios**:

1. **Given** two tenants (A and B) each with an active workspace and an authenticated subscriber, **When** a data change occurs in tenant A's workspace, **Then** only tenant A's subscriber receives the event; tenant B's subscriber receives nothing.
2. **Given** a subscriber authenticated under tenant B, **When** they attempt to create a subscription targeting a channel belonging to tenant A's workspace, **Then** the system rejects the subscription with an authorization error and no subscription is created.
3. **Given** two tenants with identically named data sources (same table/collection name in their respective workspaces), **When** data changes occur simultaneously in both, **Then** each tenant's subscriber receives only their own events, with correct tenant and workspace identifiers in the event metadata.

---

### User Story 4 — Workspace isolation verification (Priority: P1)

A QA engineer needs to verify that within a single tenant, events from one workspace are never delivered to a subscriber whose subscription targets a different workspace.

**Why this priority**: Workspace isolation is the second boundary after tenant isolation. Tenants may have multiple workspaces with different teams and access policies; cross-workspace leakage violates the workspace governance model.

**Independent Test**: Can be tested by provisioning a single tenant with two workspaces, subscribing to each independently, producing data in workspace 1, and asserting that workspace 2's subscriber receives nothing.

**Acceptance Scenarios**:

1. **Given** a single tenant with two workspaces (W1 and W2) each with active subscriptions, **When** a data change occurs in W1, **Then** only the W1 subscriber receives the event; the W2 subscriber receives nothing.
2. **Given** a developer with access to W1 but not W2, **When** they attempt to create a subscription on a W2 channel, **Then** the system rejects the request with an authorization error.

---

### User Story 5 — Scope revocation during active session (Priority: P2)

A QA engineer needs to verify that when a subscriber's scopes are narrowed or revoked during an active realtime session, event delivery is suspended or stopped within the platform's documented time window (≤ 30 seconds).

**Why this priority**: This validates the dynamic authorization enforcement from T04, which is critical for security but not part of the basic happy-path.

**Independent Test**: Can be tested by establishing a subscription, revoking the subscriber's `realtime:read` scope via IAM, and asserting that event delivery stops within 30 seconds.

**Acceptance Scenarios**:

1. **Given** a subscriber with an active subscription and valid `realtime:read` scope, **When** an administrator revokes the subscriber's `realtime:read` scope, **Then** event delivery to that subscriber stops within 30 seconds and an audit event is recorded.
2. **Given** a subscriber whose scope was revoked during a session, **When** the subscriber attempts to create a new subscription, **Then** the system rejects the request with an authorization error.

---

### Edge Cases

- What happens when a subscriber creates a subscription on a data source that has no CDC bridge configured (e.g., a PostgreSQL table outside the captured set)? The system should reject the subscription or return an explicit "no events available" status.
- What happens when events are produced at very high throughput (burst) while the subscriber is disconnected? The system should enforce the documented replay buffer limit and discard or signal overflow rather than buffering unboundedly.
- What happens when two subscribers in the same workspace subscribe to overlapping but different filters? Each subscriber should receive only events matching their own filter, with no cross-contamination.
- What happens when the Kafka broker or CDC bridge is temporarily unavailable? The subscriber's connection should remain open (if possible) and events should resume delivery when the pipeline recovers, or the subscriber should receive a structured error indicating pipeline degradation.
- What happens when a tenant is deprovisioned while a subscriber has an active session? The session should be terminated gracefully with a structured error and no further events delivered.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test suite MUST include end-to-end scenarios that exercise the complete realtime pipeline from authentication through event delivery for both PostgreSQL and MongoDB data sources.
- **FR-002**: The test suite MUST verify subscription creation, event delivery, subscription deletion, and post-deletion silence as an atomic lifecycle scenario.
- **FR-003**: The test suite MUST verify that subscription filters (operation type, entity name, field predicates) correctly narrow delivered events and do not deliver non-matching events.
- **FR-004**: The test suite MUST include reconnection scenarios that simulate connection drops and verify event resumption with at-least-once delivery semantics within the documented replay window.
- **FR-005**: The test suite MUST include token-refresh scenarios that verify uninterrupted event delivery when a token is refreshed without full disconnection.
- **FR-006**: The test suite MUST include negative reconnection scenarios (expired token, revoked token) that verify authentication rejection on reconnect.
- **FR-007**: The test suite MUST include reconnection-timeout scenarios that verify subscription suspension when the client does not reconnect within the allowed window.
- **FR-008**: The test suite MUST include multi-tenant isolation scenarios using at least two independently provisioned tenants, verifying zero cross-tenant event leakage.
- **FR-009**: The test suite MUST include adversarial cross-tenant subscription attempts (subscriber of tenant B targeting tenant A's channels) and verify rejection.
- **FR-010**: The test suite MUST include multi-workspace isolation scenarios within a single tenant, verifying zero cross-workspace event leakage.
- **FR-011**: The test suite MUST include adversarial cross-workspace subscription attempts and verify rejection.
- **FR-012**: The test suite MUST include scope-revocation scenarios that verify event delivery stops within 30 seconds of scope revocation during an active session.
- **FR-013**: Each test scenario MUST provision its own tenant(s) and workspace(s) to avoid shared-state interference between test runs.
- **FR-014**: Each test scenario MUST assert event delivery within a bounded time window (default: 10 seconds for happy-path, 30 seconds for revocation) and fail explicitly on timeout.
- **FR-015**: The test suite MUST produce a structured test report (pass/fail per scenario, timing, and failure details) suitable for CI/CD integration.
- **FR-016**: The test suite MUST be executable in an automated environment (CI/CD pipeline) without manual intervention, requiring only environment configuration (endpoints, credentials).
- **FR-017**: The test suite MUST verify that audit events are recorded for key authorization decisions (subscription granted, denied, suspended) as specified in FR-013 of 082-realtime-auth-scope-filters.
- **FR-018**: The test suite MUST include scenarios with identically named data sources across tenants/workspaces to verify that naming collisions do not cause event misrouting.

### Key Entities

- **Test Tenant**: An isolated tenant provisioned per test run, providing the multi-tenancy boundary under test.
- **Test Workspace**: A workspace within a test tenant, containing data sources (PostgreSQL tables, MongoDB collections) that produce change events.
- **Test Subscriber**: An authenticated identity (with configurable scopes) that creates subscriptions and receives events during test execution.
- **Test Subscription**: A subscription created during a test scenario, targeting a specific channel/filter combination within a workspace.
- **Test Event**: A data change (INSERT/UPDATE/DELETE) triggered during a test scenario to produce realtime events through the pipeline.
- **Test Report**: The structured output of a test suite execution, containing per-scenario pass/fail status, timing, and failure diagnostics.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The test suite covers 100% of the scenarios defined in User Stories 1–5 and all edge cases, with each scenario producing an unambiguous pass or fail result.
- **SC-002**: A complete test suite execution completes within 10 minutes in a standard CI/CD environment, enabling inclusion in pre-merge or nightly pipelines.
- **SC-003**: The test suite achieves zero false positives over 10 consecutive runs on a stable environment (no flaky tests).
- **SC-004**: Cross-tenant isolation tests demonstrate zero leaked events across 100+ data-change events per tenant in a single run.
- **SC-005**: Cross-workspace isolation tests demonstrate zero leaked events across 50+ data-change events per workspace in a single run.
- **SC-006**: Reconnection tests verify event resumption within 5 seconds of reconnection for happy-path scenarios.
- **SC-007**: Scope-revocation tests verify delivery suspension within the documented 30-second window in 100% of runs.
- **SC-008**: The test report format is parseable by standard CI/CD tooling (e.g., JUnit XML, TAP, or JSON) without custom post-processing.

---

## Assumptions

- Tenants and workspaces can be provisioned programmatically via existing platform APIs (provisioning orchestrator or equivalent).
- The IAM system (Keycloak) exposes APIs to create test users, assign scopes, and revoke scopes programmatically.
- PostgreSQL and MongoDB data sources within a workspace can be mutated via existing platform data APIs (REST or direct connection) to trigger CDC events.
- The realtime connection protocol (WebSocket, SSE, or equivalent) established in T01–T04 is stable and documented sufficiently for test client implementation.
- The reconnection replay window and subscription suspension timeout are configurable platform parameters documented in T04.
- CI/CD infrastructure provides network access to the platform endpoints (API Gateway, IAM, realtime endpoint) required for E2E execution.

---

## Risks

- **Flaky tests from timing sensitivity**: Realtime event delivery depends on asynchronous pipelines (CDC → Kafka → delivery). Tests relying on strict timing could be intermittently unstable. Mitigation: use bounded polling with generous timeouts and retry-with-backoff for event assertions rather than fixed sleeps.
- **Test environment cost**: Each test run provisions multiple tenants/workspaces, which could strain shared test environments. Mitigation: ensure proper teardown of provisioned resources after each test run; consider a dedicated test environment quota.
- **CDC bridge propagation delay**: Changes to PostgreSQL/MongoDB may take variable time to appear in Kafka depending on CDC configuration. Mitigation: document expected propagation latency and set assertion timeouts accordingly.
