# Feature Specification: Outbound Webhooks for Selected Events

**Feature Branch**: `085-outbound-webhooks`  
**Created**: 2026-03-30  
**Status**: Draft  
**Task ID**: US-DX-02-T01  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades  
**Input**: Implementar webhooks salientes para eventos seleccionados con gestión de reintentos y firma si aplica.

## Problem Statement

Developers integrating external systems with a BaaS workspace currently have no automated way to be notified when significant events occur (e.g., a new document is created, a user signs up, a function completes). They must resort to polling, which is inefficient, fragile, and introduces unnecessary latency.

Outbound webhooks solve this by allowing workspace developers and integrators to register HTTP callback endpoints that the platform invokes automatically when subscribed events fire. This enables real-time, push-based integration with external services such as CRMs, analytics pipelines, CI/CD systems, and partner APIs.

## User Scenarios & Testing

### User Story 1 — Register a Webhook Subscription (Priority: P1)

A workspace developer navigates to the developer settings (or uses the management API) to create a new webhook subscription. They specify a target URL, select one or more event types from the available catalogue, and optionally restrict delivery to a specific workspace resource scope. Upon creation, the system generates a signing secret that the developer can copy and store securely. The subscription starts in an active state and immediately begins receiving matching events.

**Why this priority**: Without registration, no other webhook capability is useful. This is the foundational flow.

**Independent Test**: Can be verified by creating a subscription via API, confirming it is persisted, and retrieving its details including the signing secret.

**Acceptance Scenarios**:

1. **Given** a workspace developer with appropriate permissions, **When** they create a webhook subscription providing a valid HTTPS URL and at least one event type, **Then** the system persists the subscription, generates a unique signing secret, and returns the subscription details including the secret (shown only once at creation time).
2. **Given** a workspace developer, **When** they attempt to create a subscription with an invalid URL (non-HTTPS, malformed), **Then** the system rejects the request with a clear validation error.
3. **Given** a workspace developer, **When** they attempt to subscribe to an event type that does not exist or is not available in their workspace, **Then** the system rejects the request indicating which event types are invalid.
4. **Given** a workspace that has reached its maximum webhook subscription quota, **When** the developer tries to create another subscription, **Then** the system rejects the request with a quota-exceeded error.

---

### User Story 2 — Receive Webhook Deliveries for Subscribed Events (Priority: P1)

When an event matching an active subscription fires within the workspace, the platform constructs a webhook payload containing the event data, signs it with the subscription's signing secret, and delivers it via HTTP POST to the registered URL. The developer's endpoint receives the payload with standard headers identifying the event type, delivery ID, and signature for verification.

**Why this priority**: Delivery is the core value proposition of the webhook system — without reliable delivery, subscriptions are meaningless.

**Independent Test**: Can be verified by triggering a known event type, capturing the outbound HTTP request, and validating payload structure, headers, and signature correctness.

**Acceptance Scenarios**:

1. **Given** an active webhook subscription for event type `document.created`, **When** a new document is created in the subscribed scope, **Then** the platform sends an HTTP POST to the registered URL within a reasonable time window containing the event payload, delivery metadata headers, and a valid HMAC signature.
2. **Given** an active subscription, **When** the target endpoint responds with an HTTP 2xx status, **Then** the delivery is marked as successful and no retry is scheduled.
3. **Given** an active subscription, **When** the target endpoint is unreachable or responds with an HTTP 5xx, **Then** the delivery is marked as failed and a retry is scheduled according to the retry policy.
4. **Given** a subscription in paused or disabled state, **When** a matching event fires, **Then** no delivery attempt is made.

---

### User Story 3 — Automatic Retry of Failed Deliveries (Priority: P1)

When a webhook delivery fails (target returns a non-2xx response or the connection times out), the platform automatically retries delivery using an exponential back-off schedule. Each retry attempt is recorded. After exhausting the maximum number of retries, the delivery is marked as permanently failed and the subscription may be automatically disabled if consecutive failures exceed a threshold.

**Why this priority**: Without retries, transient failures would cause permanent data loss for integrators. Retry logic is essential for production-grade webhook reliability.

**Independent Test**: Can be verified by configuring a subscription pointing to an endpoint that fails N times then succeeds, and confirming the system retries until success and records each attempt.

**Acceptance Scenarios**:

1. **Given** a failed delivery, **When** the retry schedule fires, **Then** the platform re-sends the same payload to the same URL with the same signature, incrementing the attempt counter in the delivery metadata.
2. **Given** a delivery that has failed all retry attempts, **When** the final retry also fails, **Then** the delivery is marked as permanently failed and a notification event is emitted internally.
3. **Given** a subscription that has accumulated consecutive permanent delivery failures beyond a configurable threshold, **When** the threshold is exceeded, **Then** the subscription is automatically disabled and the workspace developer is notified (via the console or an internal notification mechanism).
4. **Given** a delivery that failed on attempt 1 but succeeds on attempt 2, **When** the retry fires, **Then** the delivery is marked as successful, no further retries are scheduled, and the attempt history is preserved.

---

### User Story 4 — Manage Webhook Subscriptions (Priority: P2)

A workspace developer can list, view, update, pause, resume, and delete their webhook subscriptions. They can change the target URL, modify subscribed event types, or rotate the signing secret. All management operations are audited.

**Why this priority**: Operational lifecycle management is important but not needed for initial delivery flow verification.

**Independent Test**: Can be verified by performing CRUD operations on subscriptions and confirming state changes are reflected correctly.

**Acceptance Scenarios**:

1. **Given** a workspace developer, **When** they list webhook subscriptions, **Then** they see all subscriptions for their workspace with current status, event types, and target URL (signing secret is not exposed in list responses).
2. **Given** an active subscription, **When** the developer pauses it, **Then** the subscription status changes to paused and no new deliveries are attempted for matching events.
3. **Given** a paused subscription, **When** the developer resumes it, **Then** the subscription becomes active again and new matching events trigger deliveries (events that occurred during the pause are not retroactively delivered).
4. **Given** a subscription, **When** the developer requests a signing secret rotation, **Then** the system generates a new secret, invalidates the old one, and returns the new secret (shown only once). The developer may optionally receive both old and new secrets during a configurable grace period to allow zero-downtime migration.
5. **Given** a subscription, **When** the developer deletes it, **Then** the subscription is soft-deleted, pending deliveries are cancelled, and the subscription no longer matches new events.

---

### User Story 5 — View Delivery History and Debug Failures (Priority: P2)

A workspace developer can inspect recent delivery attempts for each subscription, including timestamps, HTTP status codes, response times, and error details. This enables self-service debugging of integration issues without contacting support.

**Why this priority**: Observability is critical for developer experience but can be built after core delivery is functional.

**Independent Test**: Can be verified by triggering deliveries (both successful and failed) and confirming the history endpoint returns accurate records.

**Acceptance Scenarios**:

1. **Given** a subscription with delivery history, **When** the developer queries delivery logs, **Then** they see a paginated list of recent deliveries with timestamp, event type, HTTP status code, response time, attempt number, and delivery outcome.
2. **Given** a permanently failed delivery, **When** the developer views its detail, **Then** they see all retry attempts with individual outcomes, enabling root-cause analysis.
3. **Given** a workspace, **When** the developer queries delivery history, **Then** they only see deliveries for their own workspace (never cross-tenant or cross-workspace data).

---

### User Story 6 — Verify Webhook Signatures (Priority: P2)

A developer receiving webhook payloads can verify authenticity by computing the HMAC signature using their signing secret and comparing it against the signature header sent by the platform. The platform publishes clear documentation on the signing algorithm and verification steps.

**Why this priority**: Signature verification is essential for security but is consumed client-side — the platform must provide the mechanism and documentation.

**Independent Test**: Can be verified by receiving a webhook delivery, independently computing the expected signature, and comparing it to the delivered signature header.

**Acceptance Scenarios**:

1. **Given** a webhook delivery, **When** the developer computes HMAC-SHA256 over the raw request body using their signing secret, **Then** the result matches the signature value in the platform's signature header.
2. **Given** a webhook delivery, **When** the payload or signature header is tampered with, **Then** the developer's verification logic correctly rejects it as invalid.

---

### Edge Cases

- What happens when a subscription's target URL returns a 3xx redirect? The platform must not follow redirects and must treat the response as a delivery failure (to prevent open-redirect-based attacks).
- What happens when the webhook payload exceeds a maximum size? Events producing payloads beyond the size limit are truncated or the delivery includes a reference URL to fetch the full payload separately.
- What happens when two subscriptions in the same workspace subscribe to the same event type? Each subscription receives its own independent delivery with its own signing secret.
- What happens when a workspace is suspended or deactivated? All webhook subscriptions for that workspace are automatically paused; deliveries resume if the workspace is reactivated.
- What happens when the event bus experiences back-pressure? Deliveries may be delayed but must not be silently dropped; back-pressure is handled by the internal queue.
- What happens when a subscription is deleted while retries for a previous delivery are still pending? Pending retries for deleted subscriptions are cancelled.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST allow workspace developers to create webhook subscriptions specifying a target HTTPS URL and one or more event types from the available event catalogue.
- **FR-002**: The system MUST generate a unique HMAC signing secret per subscription at creation time and display it to the user exactly once.
- **FR-003**: The system MUST deliver webhook payloads via HTTP POST to the registered URL when a matching event fires for an active subscription.
- **FR-004**: Each webhook delivery MUST include standardized headers: a unique delivery ID, event type identifier, timestamp, and HMAC-SHA256 signature computed over the raw request body using the subscription's signing secret.
- **FR-005**: The system MUST NOT follow HTTP redirects (3xx) on delivery attempts; redirects MUST be treated as failures.
- **FR-006**: The system MUST retry failed deliveries (non-2xx response or connection timeout) using an exponential back-off schedule with jitter, up to a configurable maximum number of retry attempts.
- **FR-007**: The system MUST record each delivery attempt with its outcome (HTTP status, response time, error detail) and make this history available to the subscription owner.
- **FR-008**: The system MUST automatically disable a subscription after a configurable number of consecutive permanently-failed deliveries and emit an internal notification event.
- **FR-009**: The system MUST support pausing and resuming subscriptions. Paused subscriptions MUST NOT trigger deliveries; events during the pause are not retroactively delivered upon resume.
- **FR-010**: The system MUST support signing secret rotation with an optional grace period during which both old and new secrets are valid for signature verification.
- **FR-011**: The system MUST enforce a per-workspace quota on the maximum number of webhook subscriptions.
- **FR-012**: The system MUST enforce a per-workspace rate limit on outbound webhook deliveries per time window.
- **FR-013**: The system MUST ensure full tenant isolation — a subscription in workspace A MUST NOT receive events from workspace B, and delivery history from workspace A MUST NOT be visible to workspace B.
- **FR-014**: All webhook management operations (create, update, pause, resume, delete, rotate secret) MUST generate audit log entries traceable to the acting user and workspace.
- **FR-015**: The system MUST support soft-deletion of subscriptions, cancelling any pending retries upon deletion.
- **FR-016**: The system MUST expose a paginated API for querying delivery history per subscription, filterable by outcome and date range.
- **FR-017**: The system MUST impose a connection timeout and a response timeout on each delivery attempt to prevent resource exhaustion from slow endpoints.

### Key Entities

- **Webhook Subscription**: Represents a developer's registration of interest in specific event types for a given workspace. Key attributes: subscription ID, workspace ID, tenant ID, target URL, event types, signing secret (encrypted at rest), status (active/paused/disabled), creation and modification timestamps, creator user ID.
- **Webhook Delivery**: Represents a single delivery attempt (or set of attempts) of an event payload to a subscription's target URL. Key attributes: delivery ID, subscription ID, event type, event payload reference, attempt count, current status (pending/succeeded/failed/permanently-failed), individual attempt records.
- **Delivery Attempt**: Represents one HTTP call to the target URL. Key attributes: attempt number, timestamp, HTTP status code received, response time, error detail (if any).
- **Event Type**: A catalogue entry describing an event the platform emits that can be subscribed to via webhooks. Key attributes: event type identifier, human-readable name, description, payload schema reference.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A workspace developer can create a webhook subscription and receive a first delivery for a matching event within 30 seconds of the event occurring under normal load.
- **SC-002**: Failed deliveries are retried automatically and 95% of transiently-failing endpoints (those recovering within the retry window) eventually receive successful delivery.
- **SC-003**: Developers can identify the root cause of a failed delivery within 2 minutes by inspecting delivery history through the management interface without contacting support.
- **SC-004**: Zero cross-tenant or cross-workspace data leakage in webhook deliveries and delivery history, verified through tenant isolation tests.
- **SC-005**: The system supports at least 100 active webhook subscriptions per workspace without performance degradation in event processing.
- **SC-006**: Signature verification using the documented algorithm succeeds for 100% of legitimate, untampered deliveries.
- **SC-007**: All webhook management operations produce audit log entries with actor, action, resource, and timestamp, achieving 100% audit coverage.

## Scope Boundaries

### In Scope

- Webhook subscription CRUD lifecycle (create, read, update, pause, resume, delete).
- Outbound HTTP POST delivery of event payloads with HMAC-SHA256 signing.
- Automatic retry with exponential back-off and jitter.
- Auto-disable after consecutive failure threshold.
- Delivery history and attempt logging.
- Signing secret generation, display-once, and rotation with grace period.
- Per-workspace subscription quotas and delivery rate limits.
- Tenant and workspace isolation.
- Audit logging for all management operations.

### Out of Scope

- **US-DX-02-T02**: Scheduling and automation triggers.
- **US-DX-02-T03**: Per-workspace documentation generation.
- **US-DX-02-T04**: OpenAPI publication and SDK generation.
- **US-DX-02-T05**: API key rotation procedures.
- **US-DX-02-T06**: Capability catalogue exposure.
- Webhook payload transformation or filtering rules beyond event type selection.
- Inbound webhooks (receiving external webhooks into the platform).
- Custom retry policies per subscription (the system uses a platform-wide policy).
- Webhook delivery via protocols other than HTTPS (e.g., gRPC, WebSocket).
- Console UI for webhook management (may be addressed in a companion UI task).

## Dependencies

- **US-GW-01**: API Gateway must be in place to route webhook management API calls.
- **US-UI-04**: Console infrastructure must be available if webhook management is exposed via the console.
- The platform event bus (Kafka-based) must be available to source events for webhook delivery.

## Assumptions

- The platform already has a defined event catalogue (or will define one concurrently) that lists event types available for subscription. This spec assumes at least a minimal set of event types exist.
- The platform's existing authentication and authorization mechanisms (Keycloak-based) are used to gate access to webhook management APIs; no new auth mechanism is introduced.
- HTTPS is required for all target URLs; plain HTTP endpoints are rejected at subscription creation time.
- The exponential back-off schedule and maximum retry count are platform-level configuration parameters, not per-subscription settings.
- Delivery history retention follows the platform's standard data retention policy.
- The signing algorithm is HMAC-SHA256, consistent with industry standards (Stripe, GitHub, Shopify webhooks).

## Risks

- **Event volume spikes**: If a high-traffic workspace creates subscriptions for high-frequency event types, the outbound delivery volume may strain platform resources. Mitigation: per-workspace delivery rate limits (FR-012).
- **Slow consumer endpoints**: Target URLs that are slow to respond can tie up delivery resources. Mitigation: strict connection and response timeouts (FR-017).
- **Signing secret exposure**: If a developer loses or leaks their signing secret, deliveries can be spoofed. Mitigation: secret rotation with grace period (FR-010), display-once policy (FR-002).
