# Feature Specification: Realtime Subscription Authentication, Scopes & Event Filters

**Feature Branch**: `082-realtime-auth-scope-filters`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Aplicar autenticación, scopes y filtros para limitar qué cambios recibe cada cliente realtime"  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T04  
**Dependencies**: US-DX-01-T01 (channel/subscription model), US-DX-01-T02 (PG→Kafka capture), US-DX-01-T03 (Mongo→Kafka capture)

---

## Objective & Problem Statement

Once the platform can capture data changes from PostgreSQL and MongoDB and route them through channels and subscriptions (T01–T03), **nothing yet prevents an authenticated user from receiving events they should not see**. A developer with a valid session could subscribe to a workspace channel and receive every change event — including events from tables/collections they lack permission to read, events belonging to other tenants, or events at a volume that could overwhelm their connection.

This task introduces the **authorization, scope enforcement, and filtering layer** that sits between event production and event delivery. It ensures that every realtime subscription is:

1. **Authenticated** — only identities with a valid, non-expired session/token receive events.
2. **Authorized** — the subscriber's scopes and workspace-level permissions determine which channels and event types they may observe.
3. **Filtered** — subscribers can optionally narrow delivered events beyond their permitted scope (e.g., only `INSERT` operations, only a specific table/collection, only events matching a field predicate).
4. **Isolated** — no event from tenant A ever reaches a subscriber of tenant B; no event from workspace X ever reaches a subscriber of workspace Y unless explicitly granted cross-workspace access.

Without this capability the realtime pipeline cannot be exposed to external developers safely, which blocks the entire EP-17 realtime story.

---

## Users & Consumers

| Actor | Value Received |
|-------|---------------|
| **Developer (external)** | Can trust that their subscription only delivers events they are allowed to see, enabling them to build secure client applications without additional server-side filtering. |
| **Workspace Admin** | Can define which scopes or roles grant access to specific channel types, controlling the blast radius of realtime data. |
| **Tenant Owner** | Has assurance that multi-tenant isolation is enforced at the event-delivery layer, not just at the API layer. |
| **Integrator** | Can create narrowly scoped subscriptions (e.g., only `UPDATE` events on a single collection) to reduce noise and bandwidth for backend integrations. |
| **Platform (internal)** | Gains an auditable, enforceable authorization checkpoint in the event delivery path, satisfying compliance and security requirements. |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer authenticates a realtime subscription (Priority: P1)

A developer opens a realtime connection (e.g., WebSocket or SSE) to the platform and provides their authentication credentials (token/session). The platform validates the identity before allowing any event delivery. If the token expires mid-session, event delivery pauses until the client re-authenticates or the session is terminated.

**Why this priority**: Without authentication enforcement, the entire authorization model is meaningless. This is the first gate.

**Independent Test**: Can be tested by attempting to open a realtime connection with a valid token (success), an invalid token (rejection), an expired token (rejection), and by letting a token expire during an active session (delivery pauses/disconnects).

**Acceptance Scenarios**:

1. **Given** a developer with a valid, non-expired authentication token, **When** they request a realtime connection to a workspace channel, **Then** the platform accepts the connection and begins event delivery according to subscription parameters.
2. **Given** a developer with an invalid or expired authentication token, **When** they request a realtime connection, **Then** the platform rejects the connection with a clear authentication error and no events are delivered.
3. **Given** an active realtime connection, **When** the developer's authentication token expires or is revoked, **Then** the platform stops delivering events within a bounded time window, notifies the client of the authentication expiry, and provides an opportunity to re-authenticate without losing the subscription definition.
4. **Given** a developer whose token has expired during an active session, **When** they provide a refreshed valid token, **Then** event delivery resumes from the point of interruption (or from the earliest available offset if the gap exceeds retention).

---

### User Story 2 — Platform enforces scopes on subscription creation (Priority: P1)

When a developer creates or activates a subscription, the platform checks that the developer's identity possesses the required scopes/permissions for the requested channel type and workspace. A developer without the `realtime:read` scope for a given workspace cannot subscribe. A developer with read access only to PostgreSQL channels cannot subscribe to MongoDB change channels.

**Why this priority**: Scope enforcement is the core authorization mechanism that converts authentication into meaningful access control.

**Independent Test**: Can be tested by creating subscriptions with varying scope combinations and verifying acceptance or rejection based on the scope matrix.

**Acceptance Scenarios**:

1. **Given** a developer with scope `realtime:read` for workspace W and channel type `postgresql-changes`, **When** they create a subscription to the `postgresql-changes` channel in workspace W, **Then** the subscription is created successfully.
2. **Given** a developer with scope `realtime:read` for workspace W but only for channel type `postgresql-changes`, **When** they attempt to subscribe to the `mongodb-changes` channel in workspace W, **Then** the platform rejects the subscription with an insufficient-scope error.
3. **Given** a developer with valid scopes for workspace W, **When** they attempt to subscribe to a channel in workspace Y (where they have no scopes), **Then** the platform rejects the subscription with a workspace-access-denied error.
4. **Given** a developer with no `realtime:read` scope for any workspace, **When** they attempt to create any realtime subscription, **Then** the platform rejects the request and no subscription is created.
5. **Given** a workspace admin revokes a developer's `realtime:read` scope, **When** the developer has an active subscription, **Then** the platform suspends event delivery for that subscription within a bounded time window and notifies the developer.

---

### User Story 3 — Developer applies event filters to narrow delivery (Priority: P1)

A developer who has the right to subscribe to a channel wants to receive only a subset of events — for example, only `INSERT` operations on a specific table, or only changes to documents where a field matches a value. They specify filter criteria at subscription creation time, and the platform delivers only matching events.

**Why this priority**: Filtering is essential for practical usability — without it, developers receive firehose volumes and must implement client-side filtering, wasting bandwidth and leaking data they may not need to see.

**Independent Test**: Can be tested by creating subscriptions with various filter combinations and verifying that only matching events are delivered while non-matching events are suppressed.

**Acceptance Scenarios**:

1. **Given** a subscription to the `postgresql-changes` channel with a filter specifying `operation = INSERT` and `table = orders`, **When** an `INSERT` event on table "orders" and an `UPDATE` event on table "orders" are produced, **Then** only the `INSERT` event is delivered to the subscriber.
2. **Given** a subscription with a filter specifying `table = products`, **When** events for tables "products" and "orders" are produced, **Then** only events for "products" are delivered.
3. **Given** a subscription to the `mongodb-changes` channel with a filter specifying `collection = invoices` and `operation = update`, **When** an `update` event on "invoices" and a `delete` event on "invoices" are produced, **Then** only the `update` event is delivered.
4. **Given** a subscription with no filter (empty filter or omitted), **When** events of any type are produced on the subscribed channel, **Then** all events permitted by the subscriber's scopes are delivered.
5. **Given** a developer attempts to create a subscription with a filter that references a table/collection outside their permitted scope, **Then** the platform rejects the subscription with a scope-violation error.

---

### User Story 4 — Workspace admin configures scope-to-channel mappings (Priority: P2)

A workspace administrator defines which IAM scopes or roles grant access to which channel types within their workspace. For example, the admin may decide that the `data-analyst` role can only subscribe to `postgresql-changes` channels, while the `full-developer` role can subscribe to both PostgreSQL and MongoDB channels.

**Why this priority**: While default scope-to-channel mappings suffice for initial operation, workspace-level customization is needed for production governance.

**Independent Test**: Can be tested by configuring custom scope-to-channel mappings in a workspace and verifying that developers with different roles are allowed or denied subscriptions accordingly.

**Acceptance Scenarios**:

1. **Given** a workspace with a custom scope mapping that grants `data-analyst` access only to `postgresql-changes`, **When** a developer with the `data-analyst` role attempts to subscribe to `mongodb-changes`, **Then** the subscription is rejected.
2. **Given** the same workspace, **When** a developer with the `full-developer` role subscribes to `mongodb-changes`, **Then** the subscription is created successfully.
3. **Given** no custom scope-to-channel mapping is configured for a workspace, **When** a developer with `realtime:read` scope subscribes to any available channel type, **Then** the platform falls back to the default behavior: `realtime:read` grants access to all channel types in that workspace.

---

### User Story 5 — Tenant owner reviews authorization audit trail for realtime subscriptions (Priority: P2)

A tenant owner wants to inspect who subscribed to which channels, when subscriptions were created or rejected, and why rejections occurred. The platform records all authorization decisions (grants and denials) for realtime subscriptions as auditable events.

**Why this priority**: Audit trail is critical for compliance and troubleshooting but does not block the core authorization flow.

**Independent Test**: Can be tested by creating, rejecting, and revoking subscriptions and then querying the audit log to verify all authorization decisions are recorded with the expected detail.

**Acceptance Scenarios**:

1. **Given** a developer successfully creates a subscription, **When** the tenant owner queries the subscription audit log, **Then** there is an entry recording the subscription creation with developer identity, workspace, channel type, scopes evaluated, filters applied, and timestamp.
2. **Given** a developer's subscription request is rejected due to insufficient scopes, **When** the tenant owner queries the audit log, **Then** there is an entry recording the rejection with the developer identity, requested channel, missing scopes, and rejection reason.
3. **Given** a developer's active subscription is suspended due to scope revocation, **When** the tenant owner queries the audit log, **Then** there is an entry recording the suspension event with the triggering scope change and affected subscription.

---

### Edge Cases

- **Token refresh race condition**: A client's token expires at the exact moment an event is being delivered. The platform must handle this gracefully — either buffer the event for a short retry window or drop it with an appropriate notification, but never deliver it unauthenticated.
- **Scope change propagation delay**: When an admin revokes a scope, there may be a propagation delay before the realtime layer enforces it. The spec defines a bounded maximum delay (configurable), and any events delivered during the propagation window are considered acceptable but audited.
- **Filter on non-existent entity**: A developer creates a subscription with a filter referencing a table/collection that does not yet exist. The platform accepts the subscription (the table/collection may be created later) but delivers no events until matching events appear.
- **Malformed filter expression**: A developer provides a syntactically invalid filter. The platform rejects the subscription at creation time with a validation error describing the issue.
- **Cross-workspace subscription attempt**: A developer tries to subscribe to events from a workspace other than the one their token authorizes. The platform rejects this unconditionally.
- **Subscription survives scope narrowing**: A developer has an active subscription, and an admin narrows their scopes so they still have `realtime:read` but no longer for the specific channel type. The platform detects the change and suspends delivery, rather than silently continuing.
- **High-cardinality filters**: A developer creates a subscription with an excessively complex filter (too many predicates). The platform enforces a maximum filter complexity limit and rejects subscriptions that exceed it.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST authenticate every realtime connection before delivering any events, using the platform's IAM-issued tokens (Keycloak).
- **FR-002**: The system MUST reject realtime connection attempts with invalid, expired, or revoked tokens and return a structured authentication error.
- **FR-003**: The system MUST validate that the subscriber's scopes include the required permission (e.g., `realtime:read`) for the target workspace and channel type before creating a subscription.
- **FR-004**: The system MUST reject subscription creation when the subscriber lacks the necessary scopes, returning a structured authorization error that identifies the missing scope.
- **FR-005**: The system MUST enforce tenant isolation — a subscription MUST never deliver events belonging to a different tenant than the subscriber's authenticated tenant.
- **FR-006**: The system MUST enforce workspace isolation — a subscription MUST only deliver events from the workspace specified in the subscription, and only if the subscriber has access to that workspace.
- **FR-007**: The system MUST support event filters at subscription creation time, allowing subscribers to narrow delivery by at least: operation type (INSERT/UPDATE/DELETE), source entity (table name or collection name), and simple field-level predicates on the event payload.
- **FR-008**: The system MUST validate filter expressions at subscription creation time and reject syntactically invalid or overly complex filters with a descriptive error.
- **FR-009**: The system MUST NOT deliver events matching a filter that references entities outside the subscriber's permitted scope, even if the filter syntax is valid.
- **FR-010**: The system MUST detect token expiration or revocation during an active realtime session and stop event delivery within a configurable bounded time window (default: no more than 30 seconds after expiry).
- **FR-011**: The system MUST allow a client to re-authenticate on an existing connection (token refresh) without losing the subscription definition or requiring full reconnection.
- **FR-012**: The system MUST detect scope changes (revocations or narrowing) and suspend affected subscriptions within a configurable bounded time window.
- **FR-013**: The system MUST record an audit event for every subscription authorization decision: creation granted, creation denied, delivery suspended (with reason), and delivery resumed.
- **FR-014**: The system MUST support workspace-level configuration of scope-to-channel-type mappings, with a sensible default (e.g., `realtime:read` grants access to all channel types).
- **FR-015**: The system MUST enforce a configurable maximum filter complexity per subscription (e.g., maximum number of predicates) and reject subscriptions exceeding it.
- **FR-016**: The system MUST include the subscriber's identity, tenant identifier, and workspace identifier in every audit event related to realtime authorization.

### Key Entities

- **Realtime Session**: Represents an authenticated, active connection between a client and the realtime delivery layer. Carries the client's identity, token reference, tenant, and workspace context.
- **Subscription Authorization Record**: Captures the authorization evaluation for a subscription — the scopes evaluated, the channel type requested, the outcome (granted/denied), and the timestamp. Persisted for audit.
- **Event Filter**: A declarative specification attached to a subscription that defines which events should be delivered (by operation type, entity name, and optional field predicates). Validated at creation time.
- **Scope-to-Channel Mapping**: A workspace-level configuration that defines which IAM scopes or roles grant access to which channel types. Overrides the platform default when present.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of realtime connections are authenticated before any event is delivered — zero unauthenticated event deliveries across all test scenarios.
- **SC-002**: Subscription creation requests from identities lacking required scopes are rejected within 1 second, with a clear error message identifying the missing permission.
- **SC-003**: Zero cross-tenant event leakage: in a test scenario with N tenants subscribing simultaneously, no subscriber receives an event belonging to a different tenant.
- **SC-004**: Zero cross-workspace event leakage: in a test scenario with N workspaces under the same tenant, no subscriber receives an event from a workspace they are not authorized to access.
- **SC-005**: Event filters reduce delivered event volume to subscribers — a filtered subscription receives at least 50% fewer events than an unfiltered subscription on the same channel (given a mixed-event workload).
- **SC-006**: Token expiration enforcement: event delivery stops within 30 seconds of token expiry in 99% of observed cases.
- **SC-007**: Scope revocation enforcement: affected subscriptions are suspended within 60 seconds of the scope change in 99% of observed cases.
- **SC-008**: Every authorization decision (grant, denial, suspension, resumption) is queryable in the audit log within 5 seconds of occurrence.

---

## Permissions, Multi-Tenant Isolation, Auditing, Quotas & Security

### Permissions Model

- Realtime subscriptions require at minimum a `realtime:read` scope on the target workspace. 
- Channel-type-specific scopes (e.g., `realtime:read:postgresql-changes`) may be configured per workspace to provide finer-grained control.
- Workspace admins can configure custom scope-to-channel mappings. When no custom mapping exists, the platform default applies.
- Subscription creation, suspension, and deletion actions are governed by the same permission model as other workspace resources.

### Multi-Tenant Isolation

- Tenant context is extracted from the authenticated token and is immutable for the duration of the session.
- The event delivery layer filters events by tenant identifier at the earliest possible stage — events from other tenants MUST never enter the subscriber's delivery pipeline.
- Workspace isolation is enforced as a second layer: within a tenant, a subscriber only receives events from workspaces explicitly authorized in their scopes.

### Auditing

- All authorization decisions are published as audit events to the platform's audit backbone (Kafka audit topics).
- Audit events include: actor identity, action (subscribe, reject, suspend, resume), resource (channel + workspace), scopes evaluated, outcome, and ISO 8601 timestamp.
- Audit events are immutable and retained per the tenant's audit retention policy.

### Quotas

- Maximum number of active subscriptions per developer per workspace is configurable at the workspace and tenant level.
- Maximum filter complexity (number of predicates) per subscription is configurable.
- These quotas are enforced at subscription creation time; exceeding them results in a clear error.

### Security

- Tokens are validated against the platform IAM (Keycloak) on every new connection and periodically during active sessions.
- The system does not cache authorization decisions beyond the configured token validity window.
- Filter expressions are sandboxed: they cannot reference system-internal fields, cross-workspace data, or trigger side effects.

---

## Scope Boundaries

### In Scope

- Authentication enforcement on realtime connections.
- Scope/permission validation at subscription creation.
- Event filter specification and enforcement at delivery time.
- Tenant and workspace isolation in the event delivery path.
- Scope-to-channel mapping configuration at workspace level.
- Audit trail for all authorization decisions.
- Token expiry and scope revocation detection during active sessions.

### Out of Scope

- **US-DX-01-T01**: The channel/subscription model itself (assumed to exist).
- **US-DX-01-T02**: PostgreSQL CDC pipeline to Kafka (assumed operational).
- **US-DX-01-T03**: MongoDB change stream pipeline to Kafka (assumed operational).
- **US-DX-01-T05**: SDK examples and developer documentation for subscriptions.
- **US-DX-01-T06**: End-to-end tests for reconnection and tenant isolation.
- Choice of realtime transport protocol (WebSocket, SSE, etc.) — this spec is transport-agnostic.
- Client-side SDK design or developer portal UX.
- Rate limiting on event delivery throughput (separate from subscription quotas).

---

## Assumptions

- The channel/subscription model from US-DX-01-T01 is available and provides a stable API for creating, listing, and managing subscriptions per workspace.
- Change events from PostgreSQL (T02) and MongoDB (T03) are already flowing into Kafka topics with tenant and workspace identifiers embedded in the event payload or metadata.
- The platform IAM (Keycloak) supports custom scopes that can be assigned per workspace and queried at runtime.
- A mechanism exists (or will be provided by the IAM layer) to notify the realtime layer of token revocations and scope changes within a bounded time window.

---

## Risks & Open Questions

| # | Type | Description | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | Risk | Scope revocation propagation may be slower than the 60-second target if the IAM layer does not support push-based revocation notifications. | Subscribers may receive events for up to the propagation delay after their scope is revoked. | Acceptable within bounded window; audit all events delivered during propagation. Consider polling-based scope re-validation as a fallback. |
| R2 | Risk | Complex filter expressions may degrade delivery throughput if evaluated per-event at high volumes. | Latency increase for subscribers with complex filters during burst traffic. | Enforce maximum filter complexity; optimize filter evaluation in the plan phase. |
| OQ1 | Open Question | Should the platform support field-level predicates in filters (e.g., `payload.status = 'active'`) in the initial release, or only operation-type and entity-name filters? | Determines filter expressiveness and implementation complexity. | Start with operation-type + entity-name filters; add field-level predicates as a follow-up if needed. Document this as a phased approach. |
