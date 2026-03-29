# Feature Specification: Saga/Compensation for Console Backend Workflows

**Feature Branch**: `070-saga-compensation-workflows`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Aplicar patrón saga/compensación o equivalente para workflows que modifican varios sistemas"  
**Task ID**: US-UIB-01-T04  
**Epic**: EP-16 — Backend funcional de la consola  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Multi-Step Workflow Completes Successfully with All-or-Nothing Semantics (Priority: P1)

A console backend workflow (e.g., tenant provisioning, workspace creation, credential generation) that mutates two or more platform services executes as a governed sequence of steps. If every step succeeds, the entire workflow is committed and the platform state is consistent across all affected services.

**Why this priority**: Without atomic multi-service coordination, the platform can reach inconsistent states where, for example, a Keycloak realm exists but its corresponding PostgreSQL tenant boundary does not. This is the foundational behavior that all other saga capabilities depend on.

**Independent Test**: Execute any cataloged multi-service workflow (WF-CON-002 — Tenant Provisioning is ideal because it touches Keycloak, PostgreSQL, Kafka, and APISIX). Verify that after successful completion, every affected service contains the expected state and the workflow is recorded as completed.

**Acceptance Scenarios**:

1. **Given** a superadmin initiates tenant provisioning (WF-CON-002), **When** all provisioning steps across Keycloak, PostgreSQL, Kafka, and APISIX succeed, **Then** the tenant is fully provisioned, the workflow status is marked as completed, and each service contains the expected tenant artifacts.
2. **Given** a tenant owner creates a workspace (WF-CON-003), **When** Keycloak client creation, PostgreSQL record insertion, and S3 storage reservation all succeed, **Then** the workspace is active and all three services are consistent.

---

### User Story 2 — Partial Failure Triggers Compensation and Leaves No Orphaned State (Priority: P1)

When a step in a multi-service workflow fails after one or more preceding steps have already succeeded, the system automatically executes compensation actions for the already-committed steps in reverse order. After compensation completes, the platform is in a consistent state equivalent to the workflow never having started.

**Why this priority**: This is the core value proposition of the saga pattern. Without compensation, partial failures produce orphaned resources across services—Keycloak clients without matching PostgreSQL records, APISIX routes pointing to non-existent tenants, etc. These orphans create security risks, data inconsistencies, and operational overhead.

**Independent Test**: Simulate a failure in the third step of tenant provisioning (e.g., Kafka topic creation fails after Keycloak realm and PostgreSQL boundary are created). Verify that compensation removes the PostgreSQL boundary and the Keycloak realm, and the workflow is recorded as compensated.

**Acceptance Scenarios**:

1. **Given** tenant provisioning (WF-CON-002) has completed Keycloak realm creation and PostgreSQL boundary setup, **When** Kafka topic namespace provisioning fails, **Then** the system compensates by removing the PostgreSQL boundary and the Keycloak realm in reverse order, and records the workflow as compensated with a reason.
2. **Given** workspace creation (WF-CON-003) has completed Keycloak client creation, **When** PostgreSQL workspace record insertion fails, **Then** the system compensates by deleting the Keycloak client, and records the workspace workflow as compensated.
3. **Given** credential generation (WF-CON-004) has updated Keycloak credential state, **When** APISIX consumer synchronization fails, **Then** the system compensates by reverting the Keycloak credential change, and the credential metadata is not recorded in PostgreSQL.

---

### User Story 3 — Compensation Actions Are Idempotent and Safe to Retry (Priority: P1)

Each compensation action can be safely retried without producing duplicate side effects. If a compensation action itself fails on the first attempt, the system retries it. Compensation retries do not leave the system in a worse state than before the retry.

**Why this priority**: Compensation actions interact with external services that may themselves experience transient failures. If compensation is not idempotent and retryable, a failure during compensation would leave the platform in an even more inconsistent state than the original partial failure.

**Independent Test**: Trigger a compensation scenario and simulate a transient failure in one of the compensation steps. Verify the system retries the compensation and ultimately reaches a consistent state.

**Acceptance Scenarios**:

1. **Given** a compensation action to delete a Keycloak realm fails due to a transient network error, **When** the system retries the compensation action, **Then** the Keycloak realm is deleted on retry and the overall compensation completes successfully.
2. **Given** a compensation action has already succeeded but is retried due to an ambiguous response, **When** the retry executes, **Then** the compensation action recognizes the already-compensated state and completes without error or duplicate side effects.

---

### User Story 4 — Each Workflow Step and Compensation Carries Correlation and Audit Context (Priority: P2)

Every forward step and every compensation action within a saga carries the correlation-id of the originating workflow. The audit trail records the workflow identifier, the step being executed or compensated, the actor, the tenant/workspace context, the outcome (success, failure, compensated), and a timestamp.

**Why this priority**: Without correlation across saga steps, diagnosing partial failures becomes extremely difficult. Operators and auditors need to trace the entire lifecycle of a multi-service workflow—including which steps ran, which failed, and which were compensated—as a single logical unit.

**Independent Test**: Execute a workflow that partially fails and is compensated. Query the audit log by correlation-id and verify that all forward steps and compensation steps appear as a single correlated sequence with correct outcomes.

**Acceptance Scenarios**:

1. **Given** a tenant provisioning workflow fails at step 3 and compensates steps 2 and 1, **When** an operator queries audit by the workflow's correlation-id, **Then** the audit log shows all five actions (3 forward, 2 compensation) with their individual outcomes, timestamps, and the shared correlation-id.
2. **Given** a credential generation workflow completes successfully, **When** audited, **Then** each step of the workflow appears in the audit trail under the same correlation-id with outcome "success".

---

### User Story 5 — Workflow State Is Persisted and Survives Process Restart (Priority: P2)

The current state of an in-flight saga (which steps have completed, which are pending, whether compensation is in progress) is persisted to durable storage. If the orchestrating process crashes or restarts mid-execution, the saga resumes from its last recorded state rather than starting over or being silently abandoned.

**Why this priority**: In a Kubernetes environment, pods can be evicted or restarted at any time. Without durable saga state, a restart mid-workflow would leave services in an inconsistent state with no mechanism to detect or recover the in-flight operation.

**Independent Test**: Start a multi-step workflow, forcibly terminate the orchestrating process after the second step succeeds, restart the process, and verify the saga resumes from step 3 (or compensates if the interruption is treated as a failure, depending on policy).

**Acceptance Scenarios**:

1. **Given** a tenant provisioning workflow has completed steps 1 and 2 and the process restarts before step 3 begins, **When** the process recovers, **Then** the saga either resumes at step 3 or triggers compensation for steps 1 and 2 according to the configured recovery policy, and the final state is consistent.
2. **Given** a saga is in compensation phase and the process restarts after compensating step 2 but before compensating step 1, **When** the process recovers, **Then** compensation continues from where it left off and completes by compensating step 1.

---

### User Story 6 — Saga Behavior Applies to All Cataloged Multi-Service Workflows (Priority: P2)

The saga/compensation mechanism is not specific to a single workflow. It applies uniformly to all workflows cataloged in the Console Backend Workflow Catalog (specs/067) that meet classification criteria C-1 (multi-service mutation) or C-5 (atomicity/consistency requirement): WF-CON-001 through WF-CON-006.

**Why this priority**: A reusable saga mechanism avoids per-workflow ad-hoc error handling and ensures consistent reliability guarantees across all backend console operations. The generic entry WF-CON-005 also ensures future workflows automatically benefit from the same compensation guarantees.

**Independent Test**: Verify that each non-provisional cataloged workflow (WF-CON-001 through WF-CON-004, WF-CON-006) has defined forward steps and corresponding compensation actions, and that the saga engine can orchestrate any of them using the same execution model.

**Acceptance Scenarios**:

1. **Given** a workflow definition for WF-CON-001 (User Approval) with two forward steps, **When** the second step fails, **Then** the saga engine compensates the first step using the same mechanism as any other workflow.
2. **Given** a new workflow is added to the catalog meeting criteria C-1 or C-5, **When** it defines its forward steps and compensation actions, **Then** it can be executed by the same saga engine without changes to the orchestration mechanism.

---

### Edge Cases

- **What happens when a compensation action permanently fails after all retries are exhausted?** The workflow is marked as "compensation-failed" (a terminal error state), an alert is emitted, and the specific steps that could not be compensated are recorded for manual operator intervention.
- **What happens when two concurrent sagas attempt to modify the same resource?** The system uses idempotency keys and step-level preconditions to detect conflicts. A conflicting saga step fails and triggers compensation of its already-completed steps rather than corrupting shared state.
- **What happens when an external service is completely unavailable during compensation?** The compensation is retried with exponential backoff up to a configurable maximum. If all retries are exhausted, the workflow enters "compensation-failed" state with the unreachable service and step recorded.
- **What happens when a workflow has only one service step (does not meet C-1)?** Single-service operations are excluded from saga orchestration. The catalog exclusion list (Section 3 of 067) governs this boundary.
- **What happens if saga state storage itself is unavailable?** The workflow cannot start or resume. The initiating request receives an error indicating the orchestration subsystem is temporarily unavailable, and no partial mutations are made.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST execute each cataloged multi-service workflow (WF-CON-001 through WF-CON-006) as an ordered sequence of steps where each step has a defined forward action and a corresponding compensation action.
- **FR-002**: The system MUST execute compensation actions in reverse order of the completed forward steps when any forward step fails.
- **FR-003**: Each compensation action MUST be idempotent—safe to execute multiple times with the same result.
- **FR-004**: Each forward step MUST be idempotent—safe to retry without producing duplicate resources or side effects.
- **FR-005**: The system MUST persist the current state of every in-flight saga (step progress, outcome per step, compensation progress) to durable storage so that recovery is possible after process restart.
- **FR-006**: The system MUST propagate the originating correlation-id through every forward step and every compensation action of a saga.
- **FR-007**: The system MUST record an audit entry for each forward step and each compensation action, including workflow identifier, step identifier, actor, tenant/workspace context, outcome, and timestamp.
- **FR-008**: The system MUST retry failed compensation actions with configurable retry count and backoff policy before declaring compensation failure.
- **FR-009**: The system MUST mark a workflow as "compensation-failed" when compensation retries are exhausted, and MUST record the specific steps that remain uncompensated for manual intervention.
- **FR-010**: The system MUST support a uniform saga execution model that any cataloged workflow can use by defining its forward and compensation steps, without requiring workflow-specific orchestration logic.
- **FR-011**: The system MUST NOT start forward step N+1 until forward step N has been durably recorded as succeeded.
- **FR-012**: The system MUST NOT skip compensation steps—every completed forward step MUST have its compensation executed when the saga fails, in reverse order.
- **FR-013**: The system MUST expose the current saga state (in-progress, completed, compensating, compensated, compensation-failed) through an API or status model consumable by the job/operation status subsystem (US-UIB-02).

### Key Entities

- **Saga Instance**: Represents a single execution of a multi-service workflow. Carries a unique identifier, the workflow type (e.g., WF-CON-002), the originating actor, the tenant/workspace context, the correlation-id, the current phase (executing, compensating, terminal), and the overall outcome.
- **Saga Step**: Represents one forward action within a saga. Carries a step ordinal, a reference to the forward action, a reference to the corresponding compensation action, the step's current state (pending, succeeded, failed, compensated, compensation-failed), input parameters, and output/result data needed by subsequent steps.
- **Compensation Policy**: Configuration that governs retry behavior for compensation actions—maximum retries, backoff strategy, and the terminal action when retries are exhausted (mark as compensation-failed and alert).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of cataloged multi-service workflows (WF-CON-001 through WF-CON-004, WF-CON-006) have defined compensation actions for every forward step.
- **SC-002**: When a forward step fails in any workflow, the system compensates all previously completed steps within the configured retry window, leaving zero orphaned resources across services.
- **SC-003**: After a simulated process crash mid-workflow, the saga resumes or compensates within one recovery cycle, and the final platform state is consistent.
- **SC-004**: Every forward step and compensation action is traceable in the audit log by correlation-id, with 100% coverage—no saga action is unaudited.
- **SC-005**: Compensation actions can be retried at least 3 times without producing duplicate side effects across any affected service.
- **SC-006**: An operator can determine the full lifecycle of any saga (which steps ran, which failed, which were compensated) from the audit log in under 2 minutes.

## Assumptions

- The Console Backend Workflow Catalog (specs/067-console-workflow-catalog/catalog.md v1.0.0) is the authoritative source for which workflows require saga behavior. This spec does not redefine or expand that catalog.
- Backend workflow functions (US-UIB-01-T02) already exist or will exist as individual OpenWhisk actions that this saga mechanism orchestrates. This spec defines the orchestration and compensation behavior, not the individual action implementations.
- Endpoint separation (US-UIB-01-T03) is already defined, so the saga engine is invoked from backend-orchestrated endpoints, not directly from the SPA.
- Audit infrastructure and correlation-id propagation (US-UIB-01-T05) will build on the audit context defined here but are specified separately. This spec defines what the saga must provide to the audit subsystem, not the audit subsystem itself.
- Durable storage for saga state uses the platform's existing PostgreSQL infrastructure. No additional storage technology is assumed.
- The shared sub-workflows (SWF-CON-A, SWF-CON-B, SWF-CON-C) from the catalog are decomposition hints. This spec treats them as reusable step definitions that the saga engine orchestrates, not as independently orchestrated sub-sagas.

## Scope Boundaries

### In Scope

- Saga orchestration model: step sequencing, compensation triggering, state persistence, and recovery.
- Compensation action definition requirements for each cataloged workflow.
- Idempotency requirements for forward and compensation actions.
- Correlation-id and audit context propagation within sagas.
- Saga state exposure for the job/operation status subsystem.

### Out of Scope

- Individual OpenWhisk action implementations for workflow steps (US-UIB-01-T02).
- Audit subsystem implementation and dashboards (US-UIB-01-T05).
- End-to-end testing of workflow failures with compensation (US-UIB-01-T06).
- Job/operation status model, UI progress display, and retry UX (US-UIB-02).
- Console endpoint routing and SPA-vs-backend separation (US-UIB-01-T03).
