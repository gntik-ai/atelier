# Feature Specification: E2E Tests for Complex Workflows with Partial Failure Compensation

**Feature Branch**: `072-workflow-e2e-compensation`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Crear pruebas E2E de workflows complejos y fallos parciales con compensación"
**Backlog Traceability**: US-UIB-01-T06 · Epic EP-16 · Historia US-UIB-01

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Verify Happy-Path Multi-Step Workflow Completion (Priority: P1)

A QA engineer or CI pipeline executes an end-to-end test that exercises a complete console backend workflow (e.g., tenant provisioning) from trigger to final confirmation, asserting that every orchestrated step completes successfully and that the resulting state is consistent across all involved systems.

**Why this priority**: Without proving happy-path correctness first, compensation-path tests have no reliable baseline.

**Independent Test**: Run the E2E suite targeting a single multi-step workflow (e.g., workspace creation). The test provisions a tenant context, triggers the workflow, and asserts all expected side-effects (resource created, audit entry recorded, correlation-id propagated).

**Acceptance Scenarios**:

1. **Given** a valid tenant context and required preconditions, **When** the workflow is triggered via its console endpoint, **Then** every step completes, the final resource is created, and an audit trail with a single correlation-id is persisted.
2. **Given** a workflow that spans at least three distinct backend operations, **When** it completes successfully, **Then** no compensation actions are triggered and idempotent re-execution produces no duplicate side-effects.

---

### User Story 2 — Verify Partial Failure Detection and Compensation Execution (Priority: P1)

A QA engineer or CI pipeline injects a controlled failure at a known intermediate step of a multi-step workflow and asserts that the saga/compensation mechanism detects the failure, rolls back completed steps in the correct reverse order, and leaves the system in a consistent, clean state.

**Why this priority**: Compensation correctness under partial failure is the core safety property that this task must validate.

**Independent Test**: Trigger a multi-step workflow with a fault-injection flag (or a test double that forces failure at step N). Assert that steps 1…N-1 are compensated, the final state shows no partially-created resources, and an audit entry records both the failure and each compensation action.

**Acceptance Scenarios**:

1. **Given** a workflow of N steps where step K (1 < K ≤ N) is configured to fail, **When** the workflow executes, **Then** steps 1…K-1 are compensated in reverse order, each compensation is recorded in the audit log, and no orphan resources remain.
2. **Given** a compensation action that itself fails on first attempt, **When** the compensation mechanism retries, **Then** it succeeds within the configured retry budget and the overall rollback completes.
3. **Given** a partial failure has been compensated, **When** the same workflow is re-triggered with the original idempotency key, **Then** it executes cleanly as a fresh run (no stale compensation state interferes).

---

### User Story 3 — Verify Multi-Tenant Isolation in Workflow Tests (Priority: P2)

A platform engineer confirms that E2E workflow tests operating under one tenant cannot observe, modify, or compensate resources belonging to another tenant, even when failures and compensations are in progress concurrently.

**Why this priority**: Multi-tenant isolation is a cross-cutting safety requirement for every BaaS capability.

**Independent Test**: Run two workflow test instances concurrently under different tenant contexts (one succeeding, one failing with compensation). Assert that each tenant's resources and audit entries are isolated, and no cross-tenant side-effects occur.

**Acceptance Scenarios**:

1. **Given** two tenants A and B each running the same workflow concurrently, **When** tenant B's workflow fails and triggers compensation, **Then** tenant A's workflow and resources are completely unaffected.
2. **Given** a workflow E2E test executing under tenant A, **When** it queries for compensation history, **Then** it retrieves only tenant A's records and never tenant B's.

---

### User Story 4 — Verify Audit and Correlation Traceability Across Workflow Lifecycle (Priority: P2)

An operations engineer or auditor reviews the audit log after an E2E test run (both success and failure+compensation paths) and can reconstruct the full lifecycle of each workflow instance using a single correlation-id, including which steps executed, which failed, and which were compensated.

**Why this priority**: Auditability and traceability are explicit acceptance criteria of the parent story US-UIB-01.

**Independent Test**: After running happy-path and failure-path E2E workflows, query the audit log by correlation-id and assert completeness (every step, failure, and compensation action is present with timestamps and actor identity).

**Acceptance Scenarios**:

1. **Given** a completed workflow (success or compensated failure), **When** the audit log is queried by its correlation-id, **Then** all step transitions, outcomes, and compensation actions are present in chronological order.
2. **Given** a compensated workflow, **When** the audit entries are reviewed, **Then** each compensation action references the original failed step and the tenant/actor context.

---

### User Story 5 — Verify Idempotency Under Retry and Re-execution (Priority: P3)

A QA engineer re-executes a workflow that previously completed (or was compensated) using the same idempotency key and confirms that no duplicate side-effects are produced—no duplicate resources, no duplicate audit entries, and no spurious compensation triggers.

**Why this priority**: Idempotency is an explicit acceptance criterion of US-UIB-01 and prevents data corruption in production retry scenarios.

**Independent Test**: Execute a workflow, record its idempotency key, then re-execute with the same key. Assert identical final state and no duplicate audit entries.

**Acceptance Scenarios**:

1. **Given** a successfully completed workflow with idempotency key K, **When** the workflow is triggered again with key K, **Then** the system returns the original result without executing steps again.
2. **Given** a workflow that was compensated after failure, **When** it is re-triggered with a new idempotency key, **Then** it executes fresh without interference from previous compensation state.

---

### Edge Cases

- What happens when all steps fail (step 1 fails) — compensation should be a no-op since nothing was committed.
- What happens when the compensation mechanism itself is unavailable (e.g., downstream service unreachable during rollback) — the test must assert the system enters a known "compensation-pending" state and does not silently drop the rollback.
- What happens when a workflow is triggered with an expired or invalid tenant context — the test must assert immediate rejection before any steps execute.
- What happens when concurrent compensations for the same workflow instance are triggered (e.g., duplicate failure signals) — the system must ensure compensation is executed exactly once.
- What happens when a workflow step produces side-effects in an external system that does not support transactional rollback — the test must assert that the compensation records the limitation and flags the resource for manual review.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The E2E test suite MUST exercise at least one multi-step workflow end-to-end through its console endpoint, covering the full lifecycle from trigger to final state assertion.
- **FR-002**: The E2E test suite MUST support fault injection at configurable workflow steps to trigger partial failures without modifying production workflow code.
- **FR-003**: The E2E tests MUST assert that compensation actions execute in the correct reverse order when a partial failure occurs and that no orphan resources remain after compensation.
- **FR-004**: The E2E tests MUST verify that every workflow execution (success or failure+compensation) produces a complete audit trail queryable by a single correlation-id.
- **FR-005**: The E2E tests MUST verify multi-tenant isolation: a workflow failure and compensation in one tenant context MUST NOT affect another tenant's resources or audit entries.
- **FR-006**: The E2E tests MUST verify idempotency: re-executing a workflow with the same idempotency key MUST NOT produce duplicate side-effects or duplicate audit entries.
- **FR-007**: The E2E tests MUST verify that compensation retries succeed within a bounded retry budget when a compensation action transiently fails.
- **FR-008**: The E2E tests MUST be executable in CI pipelines without manual intervention, producing machine-readable pass/fail results.
- **FR-009**: The E2E tests MUST cover at least three distinct workflow types representative of console backend operations (e.g., tenant provisioning, workspace creation, credential generation).
- **FR-010**: The E2E tests MUST assert that workflows that span multiple backend services maintain data consistency after both successful completion and compensated failure.

### Key Entities

- **Workflow Instance**: A single execution of a multi-step orchestrated process, identified by a unique correlation-id and associated with a tenant context and idempotency key.
- **Workflow Step**: An individual operation within a workflow instance, with recorded outcome (success/failure) and an optional compensation action.
- **Compensation Action**: A reversing operation triggered when a step fails, associated with the original step and recorded in the audit log.
- **Audit Entry**: An immutable record of a workflow event (step execution, failure, compensation), tagged with correlation-id, tenant-id, actor, and timestamp.
- **Fault Injection Point**: A test-controlled mechanism to force failure at a specific workflow step for E2E validation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of E2E test scenarios (happy path, partial failure + compensation, idempotent re-execution) pass in a clean CI run.
- **SC-002**: After a compensated partial failure, zero orphan resources remain in any involved system within the test tenant.
- **SC-003**: Every workflow execution (success or failure) produces a complete, queryable audit trail reconstructable from a single correlation-id.
- **SC-004**: Concurrent workflow tests across two or more tenants produce zero cross-tenant side-effects or data leakage.
- **SC-005**: Idempotent re-execution of a completed workflow produces zero duplicate resources and zero duplicate audit entries.
- **SC-006**: Compensation retries for transient failures resolve within 3 retry attempts without manual intervention.
- **SC-007**: The full E2E test suite completes within 10 minutes in a standard CI environment.

## Assumptions

- The saga/compensation orchestration layer (US-UIB-01-T04) is already implemented and functional before this E2E test task begins.
- Audit logging with correlation-id support (US-UIB-01-T05) is available and operational.
- Console backend workflow functions (US-UIB-01-T02) exist and are deployed for at least three representative workflow types.
- Endpoint separation (US-UIB-01-T03) is in place so tests can target the correct console endpoints.
- A test-tenant provisioning mechanism exists to create isolated tenant contexts for E2E tests.
- Fault injection can be achieved via test configuration or test doubles without modifying production workflow code.

## Out of Scope

- Implementing the workflows themselves (covered by US-UIB-01-T02).
- Implementing the saga/compensation pattern (covered by US-UIB-01-T04).
- Implementing audit logging (covered by US-UIB-01-T05).
- Performance/load testing of workflows.
- UI/frontend E2E testing of console views.
