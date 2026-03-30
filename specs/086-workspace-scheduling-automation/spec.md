# Feature Specification: Workspace Scheduling & Automation

**Feature Branch**: `086-workspace-scheduling-automation`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Implementar scheduling/automatizaciones cuando el subsistema esté habilitado en el diseño final."

**Backlog Traceability**:
- **Task ID**: US-DX-02-T02
- **Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador
- **Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades
- **Priority**: P1
- **RF Coverage**: RF-DX-006, RF-DX-007
- **Story Dependencies**: US-GW-01, US-UI-04
- **Task Dependencies**: US-DX-02-T01 (outbound webhooks)

---

## Problem Statement

Developers and workspace administrators building on the BaaS platform currently lack the ability to schedule recurring or deferred operations within their workspaces. Without a scheduling subsystem, any automation—such as periodic data cleanup, report generation, scheduled notifications, or timed workflow triggers—must be orchestrated entirely outside the platform, increasing integration friction and reducing the self-service value of the BaaS offering.

This task delivers a minimal, workspace-scoped scheduling capability that lets consumers define time-based triggers for platform-supported actions, governed by multi-tenant isolation, quotas, and auditability.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer Creates a Scheduled Job (Priority: P1)

A developer with write access to a workspace wants to schedule a recurring action (e.g., invoke a serverless function every hour) using the platform's API or console. They define the schedule expression, the target action, and optional payload. The platform validates, persists, and begins executing the schedule at the specified cadence.

**Why this priority**: This is the core capability — without it the subsystem delivers no value.

**Independent Test**: Can be fully tested by creating a scheduled job via API, waiting for at least one execution window, and verifying the target action was invoked with the correct payload.

**Acceptance Scenarios**:

1. **Given** a workspace with the scheduling capability enabled and a valid developer session, **When** the developer creates a scheduled job with a cron expression, a target action reference, and an optional JSON payload, **Then** the platform persists the job, returns a unique job identifier, and begins triggering at the specified cadence.
2. **Given** a workspace where the scheduling capability is disabled at the tenant or workspace level, **When** a developer attempts to create a scheduled job, **Then** the platform rejects the request with a clear error indicating the capability is not enabled.
3. **Given** a developer provides an invalid cron expression or references a non-existent target action, **When** they submit the scheduled job, **Then** the platform returns a descriptive validation error and does not persist the job.

---

### User Story 2 — Developer Manages Existing Scheduled Jobs (Priority: P1)

A developer needs to list, pause, resume, update, or delete scheduled jobs they previously created within their workspace. They use the API or console to view job status, modify the schedule or payload, and control execution.

**Why this priority**: Management lifecycle is inseparable from creation for a usable scheduling subsystem.

**Independent Test**: Can be tested by creating a job, listing it, pausing it, confirming no further executions occur, resuming it, updating the cron expression, and finally deleting it — verifying state transitions at each step.

**Acceptance Scenarios**:

1. **Given** a workspace with existing scheduled jobs, **When** the developer lists scheduled jobs, **Then** the platform returns a paginated list with job identifiers, schedule expressions, statuses, next-execution timestamps, and target references — scoped to the current workspace only.
2. **Given** an active scheduled job, **When** the developer pauses it, **Then** the platform stops scheduling further executions until the job is resumed, and the job status reflects "paused."
3. **Given** a paused scheduled job, **When** the developer resumes it, **Then** the platform recalculates the next execution time and resumes triggering.
4. **Given** an existing scheduled job, **When** the developer updates its cron expression or payload, **Then** the platform validates the new values, persists the change, and recalculates the next execution time.
5. **Given** an existing scheduled job, **When** the developer deletes it, **Then** the platform marks it as deleted, cancels pending executions, and the job no longer appears in active listings.

---

### User Story 3 — Workspace Admin Reviews Scheduling Activity (Priority: P2)

A workspace administrator wants visibility into scheduling activity: which jobs exist, when they last ran, whether executions succeeded or failed, and how much quota is being consumed. They use the console or API to inspect execution history.

**Why this priority**: Observability is essential for production use but secondary to the core CRUD + execution flow.

**Independent Test**: Can be tested by creating a scheduled job, allowing several executions, then querying execution history and verifying entries with status, timestamps, and duration.

**Acceptance Scenarios**:

1. **Given** a scheduled job that has been triggered multiple times, **When** the admin queries execution history for that job, **Then** the platform returns a paginated list of executions with status (succeeded / failed / timed-out), start time, duration, and a reference to any error output.
2. **Given** a workspace with multiple scheduled jobs, **When** the admin requests a scheduling summary, **Then** the platform returns aggregate counts of active, paused, and errored jobs plus current quota usage vs. limits.

---

### User Story 4 — Tenant Owner Controls Scheduling Enablement and Limits (Priority: P2)

A tenant owner decides whether the scheduling subsystem is available for their workspaces and configures quota limits (max jobs per workspace, max execution frequency). The console or API reflects these governance controls.

**Why this priority**: Governance is required for multi-tenant safety but can be delivered as a thin layer once the core engine exists.

**Independent Test**: Can be tested by toggling scheduling enablement at the tenant/workspace level and verifying that API requests from a workspace correctly accept or reject based on the current enablement flag and quota values.

**Acceptance Scenarios**:

1. **Given** a tenant with scheduling disabled, **When** any workspace under that tenant attempts to create a scheduled job, **Then** the platform rejects the request.
2. **Given** a workspace that has reached its maximum number of active scheduled jobs, **When** a developer tries to create an additional job, **Then** the platform rejects the request with a quota-exceeded error.
3. **Given** a tenant owner updating the max jobs per workspace, **When** the new limit is saved, **Then** existing jobs above the new limit remain active (no retroactive deletion) but no new jobs can be created until the count falls below the limit.

---

### Edge Cases

- What happens when a scheduled job's target action is deleted or becomes unavailable after the job is created? → The execution attempt is recorded as failed with a descriptive error; the job transitions to an "errored" status after a configurable number of consecutive failures, and an audit event is emitted.
- What happens when the scheduling subsystem is disabled while active jobs exist? → Active jobs are suspended (paused) automatically; they are not deleted. If the subsystem is re-enabled, the tenant owner or workspace admin must explicitly resume them.
- What happens when a cron expression resolves to an extremely high frequency (e.g., every second)? → The platform enforces a minimum interval floor (configurable per tenant) and rejects expressions that resolve below it.
- What happens when two scheduled jobs target the same action at overlapping times? → Both executions proceed independently; no implicit mutual exclusion is applied unless the target action itself is idempotent.
- What happens if the platform experiences downtime during a scheduled trigger window? → Missed executions are detected on recovery; the platform records a "missed" status entry and triggers the next scheduled occurrence normally (no back-filling by default).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST allow developers with appropriate workspace permissions to create scheduled jobs specifying: a cron expression (5-field UNIX-style), a target action reference (e.g., a serverless function identifier), and an optional JSON payload.
- **FR-002**: The platform MUST validate cron expressions at creation and update time, rejecting syntactically invalid expressions and expressions that resolve below the tenant's configured minimum interval.
- **FR-003**: The platform MUST assign a unique, workspace-scoped identifier to each scheduled job upon creation.
- **FR-004**: The platform MUST support the following lifecycle transitions for a scheduled job: active → paused, paused → active (resumed), any state → deleted (soft-delete).
- **FR-005**: The platform MUST allow developers to update the cron expression, target action, and payload of an existing scheduled job.
- **FR-006**: The platform MUST expose a paginated listing of scheduled jobs within a workspace, including: job identifier, cron expression, status, target action reference, next scheduled execution time, created/updated timestamps.
- **FR-007**: The platform MUST expose a paginated execution history per scheduled job, including: execution identifier, status (succeeded, failed, timed-out, missed), start time, duration, and error summary when applicable.
- **FR-008**: The platform MUST enforce a configurable maximum number of active scheduled jobs per workspace (quota). Attempts to exceed the quota MUST be rejected.
- **FR-009**: The platform MUST allow tenant owners or platform administrators to enable or disable the scheduling capability at the tenant and/or workspace level.
- **FR-010**: When the scheduling capability is disabled for a workspace, the platform MUST reject new job creation and MUST automatically pause all active jobs in that workspace.
- **FR-011**: The platform MUST emit auditable events for: job created, job updated, job paused, job resumed, job deleted, execution succeeded, execution failed, capability toggled, quota exceeded.
- **FR-012**: The platform MUST ensure complete tenant isolation — scheduled jobs, execution history, and configuration from one tenant MUST NOT be visible or accessible to another tenant.
- **FR-013**: The platform MUST automatically transition a scheduled job to an "errored" status after a configurable number of consecutive execution failures and emit an audit event.

### Key Entities

- **ScheduledJob**: Represents a developer-defined time-based trigger within a workspace. Key attributes: unique identifier, workspace reference, tenant reference, cron expression, target action reference, payload, status (active / paused / errored / deleted), consecutive failure count, created-by user, created/updated timestamps.
- **ScheduledExecution**: Represents a single invocation attempt of a scheduled job. Key attributes: unique identifier, parent job reference, status (succeeded / failed / timed-out / missed), start time, end time, duration, error summary, correlation identifier for tracing.
- **SchedulingConfiguration**: Tenant-/workspace-level settings governing the subsystem. Key attributes: enabled flag, maximum active jobs per workspace, minimum allowed interval, maximum consecutive failures before auto-error.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can create, list, update, pause, resume, and delete scheduled jobs within a workspace in under 2 seconds per operation.
- **SC-002**: Scheduled jobs execute within 60 seconds of their cron-defined trigger time under normal platform load.
- **SC-003**: 100 % of scheduling lifecycle events (creation, update, pause, resume, deletion, execution outcomes, capability toggles, quota violations) are captured in the audit log.
- **SC-004**: A developer from tenant A cannot discover, read, modify, or trigger any scheduled job belonging to tenant B under any API path or parameter manipulation.
- **SC-005**: When the scheduling capability is disabled for a workspace, 100 % of creation requests are rejected and all previously-active jobs are paused within one scheduling cycle.
- **SC-006**: The scheduling summary endpoint accurately reflects active, paused, and errored job counts and current quota usage for a workspace.

---

## Scope Boundaries

### In Scope

- CRUD lifecycle and state machine for scheduled jobs within a workspace.
- Cron-based trigger resolution and execution dispatch to a platform-supported target (serverless function).
- Execution history and observability per job.
- Tenant/workspace-level enablement toggle and quota enforcement.
- Audit events for all scheduling lifecycle transitions.
- Tenant isolation of all scheduling data.

### Out of Scope

- **US-DX-02-T01**: Outbound webhook delivery and retry engine.
- **US-DX-02-T03**: Per-workspace documentation generation.
- **US-DX-02-T04**: OpenAPI publication and SDK generation.
- **US-DX-02-T05**: API key rotation without downtime.
- **US-DX-02-T06**: Workspace capability catalog.
- Complex workflow orchestration or DAG-based scheduling (beyond single-action cron triggers).
- Back-filling of missed executions during platform downtime.
- UI design for the scheduling console pages (this spec covers behavior, not visual design).

---

## Assumptions

- The workspace capability-enablement mechanism already exists or is being delivered in parallel (US-DX-02-T06 / capability catalog). This task assumes a boolean "scheduling_enabled" flag is queryable at the workspace/tenant level.
- Target actions for scheduled jobs are limited to serverless functions registered in the workspace's function catalog. Other target types (e.g., HTTP endpoints, internal workflows) are future extensions.
- Cron expressions follow standard 5-field UNIX format (minute, hour, day-of-month, month, day-of-week). Seconds-level granularity and non-standard extensions are out of scope.
- Quota defaults (max jobs per workspace, minimum interval) will be defined during the planning phase; the spec requires them to be configurable, not fixed.

---

## Risks & Open Questions

- **Risk**: If the capability-enablement flag (scheduling_enabled) is not yet available from the workspace configuration model, this feature will need a temporary local flag — increasing future refactoring cost. **Mitigation**: Coordinate with US-DX-02-T06 delivery timeline.
- **Risk**: High-frequency scheduled jobs across many workspaces could create a "thundering herd" effect on the underlying execution platform (OpenWhisk). **Mitigation**: The minimum-interval floor and per-workspace quota cap the worst-case load; additional rate-smoothing can be planned if needed.
