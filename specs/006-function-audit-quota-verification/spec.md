# Feature Specification: Function Deployment Audit, Rollback Evidence, and Quota-Enforcement Verification

**Feature Branch**: `006-function-audit-quota-verification`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Deployment/admin auditability for functions, rollback test evidence, and quota-enforcement verification. Backlog reference: US-FN-03-T06."

**Compatibility note**: This feature builds on capabilities already delivered by sibling tasks. It assumes that function versioning and rollback (US-FN-03-T01), workspace secrets (US-FN-03-T02), quota guardrails (US-FN-03-T03), console backend on OpenWhisk (US-FN-03-T04), and import/export with visibility policies (US-FN-03-T05) are available. This task does not redefine any of their behavior; it adds the audit, evidence, and verification layer that makes those capabilities governable and demonstrable.

## 1. User Scenarios & Testing

### Primary user scenarios

1. **Tenant owners and workspace admins review deployment audit records**
   - A privileged operator inspects the audit trail for function deployments in their tenant or workspace.
   - The trail shows who deployed, what changed, when, and in which scope, without exposing unrelated tenants or workspaces.

2. **Tenant owners and workspace admins review administrative action audit records**
   - A privileged operator inspects the audit trail for administrative actions on functions such as configuration changes, visibility changes, enable/disable, and deletion.
   - Each record attributes the action to the actor, scope, and timestamp.

3. **Operators verify rollback events through audit evidence**
   - After a rollback is performed (via the versioning capability from US-FN-03-T01), the product records audit evidence of the rollback including the source version, target version, actor, and outcome.
   - An auditor or workspace admin can retrieve the rollback evidence to confirm what happened and why.

4. **Operators verify that quota enforcement produced the expected denial or allowance**
   - When a quota guardrail (from US-FN-03-T03) blocks or allows a function action, the product records verification evidence of the enforcement decision.
   - An authorized operator can review quota enforcement records to confirm that limits were respected and that denials were correctly applied.

5. **Security reviewers and superadmins inspect cross-scope audit coverage**
   - A superadmin reviews audit coverage across tenants to confirm that deployment, administration, rollback, and quota enforcement events are being recorded consistently.
   - The review does not reveal tenant-specific business data but confirms that governance events are present.

### Testing expectations

- **Given** a function is deployed to a workspace, **when** an authorized operator queries the deployment audit trail, **then** they find a record that identifies the actor, the function, the workspace, the tenant, the timestamp, and the nature of the deployment.
- **Given** an administrative action is performed on a function (e.g., visibility change, deletion, configuration update), **when** the audit trail is queried, **then** the record captures the action type, the actor, the target, the scope, and the timestamp.
- **Given** a function rollback is executed, **when** the audit trail is queried, **then** there is a rollback-specific record showing the source version, the target version, the actor, the scope, and the outcome (success or failure).
- **Given** a quota guardrail blocks a function action, **when** the quota enforcement log is queried, **then** there is a record showing which quota dimension was involved, the scope, the requesting actor, and the denial reason.
- **Given** a quota guardrail allows a function action near a threshold, **when** the quota enforcement log is queried, **then** there is a record confirming the action was permitted and the remaining capacity at that point.
- **Given** a user queries audit records outside their authorized tenant or workspace, **when** the request is evaluated, **then** the product denies it without revealing cross-scope audit content.

## 2. Edge Cases

- **A deployment and a rollback happen in rapid succession for the same function**
  - The product must record both events as distinct audit entries with correct ordering and attribution.

- **A quota enforcement denial and a subsequent retry after capacity is freed happen close together**
  - Both the denial and the later allowance must appear as separate, correctly attributed records.

- **An administrative action is performed by the console backend path (US-FN-03-T04) rather than a direct user**
  - The audit record must identify the console backend as the initiating path while preserving the original actor and scope context.

- **A rollback fails mid-execution**
  - The product must record the rollback attempt with an outcome indicating failure, not omit the record.

- **A superadmin queries audit coverage but tenant-specific content must remain hidden**
  - The product must allow governance-level verification (event presence and completeness) without exposing business-level details of each tenant's functions.

- **Audit records accumulate for a high-activity workspace**
  - The product must support filtered and time-bounded queries so that operators can retrieve relevant records without unbounded result sets.

- **A quota enforcement event occurs for a dimension that has no explicit workspace-level limit but does have a tenant-level limit**
  - The enforcement record must correctly attribute the decision to the tenant-level guardrail.

## 3. Requirements

### Functional requirements

1. **Deployment audit trail**
   - The product MUST record an audit entry for every function deployment, capturing the actor, function identity, workspace, tenant, timestamp, and the nature of the deployment (create, update, redeploy).

2. **Administrative action audit trail**
   - The product MUST record an audit entry for every administrative action on a function, including configuration changes, visibility changes, enable/disable, and deletion.
   - Each entry MUST capture the actor, action type, target function, scope, and timestamp.

3. **Rollback evidence**
   - The product MUST record a specific audit entry when a function rollback is performed, capturing the source version, target version, actor, scope, timestamp, and outcome (success or failure).
   - Rollback evidence MUST be queryable independently from general deployment audit records.

4. **Quota enforcement verification**
   - The product MUST record evidence when a quota guardrail blocks a function action, including the quota dimension, the scope, the requesting actor, and the denial reason.
   - The product MUST record evidence when a function action is permitted near a quota threshold, including the remaining capacity at the time of the decision.

5. **Scope-bounded audit access**
   - The product MUST restrict audit record access to the caller's authorized tenant and workspace.
   - The product MUST NOT expose audit content from one tenant or workspace to another through audit queries.

6. **Superadmin governance visibility**
   - The product MUST allow superadmins to verify audit coverage completeness across tenants without exposing tenant-specific business data.
   - Coverage verification MUST confirm that deployment, administration, rollback, and quota enforcement events are being captured for active scopes.

7. **Console backend attribution**
   - When an auditable action originates from the console backend path (US-FN-03-T04), the audit record MUST identify the console backend as the initiating path while retaining the original actor and scope attribution.

8. **Filtered and time-bounded queries**
   - The product MUST support filtering audit records by action type, time range, actor, and function identity within the caller's authorized scope.
   - The product MUST support bounded result sets to prevent unbounded query responses.

9. **Event ordering and distinctness**
   - The product MUST record concurrent or sequential events as distinct audit entries with correct temporal ordering.
   - The product MUST NOT merge or collapse separate auditable events into a single record.

10. **Feature boundary**
    - The scope of this feature MUST remain limited to audit, evidence, and verification for function deployment, administration, rollback, and quota enforcement.
    - This feature MUST NOT redefine versioning, rollback mechanics, secret management, quota enforcement logic, console backend execution, or import/export behavior, all of which are owned by sibling tasks.

### Key Entities

- **Deployment Audit Entry**: A record of a function deployment event, including actor, function, scope, timestamp, and deployment nature.
- **Administrative Action Audit Entry**: A record of a non-deployment administrative action on a function, including actor, action type, target, scope, and timestamp.
- **Rollback Evidence Record**: A specific audit entry for a rollback event, including source version, target version, actor, scope, timestamp, and outcome.
- **Quota Enforcement Record**: A record of a quota guardrail decision, including dimension, scope, actor, decision (allowed or denied), and capacity detail.
- **Audit Coverage Report**: A governance-level summary confirming that expected event types are being recorded for active scopes, without revealing tenant-specific business data.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: Every function deployment produces a queryable audit entry within the correct tenant and workspace scope.
- **SC-002**: Every administrative action on a function produces a queryable audit entry with the correct action type and attribution.
- **SC-003**: Every rollback event produces a rollback-specific evidence record that an auditor can retrieve and verify independently.
- **SC-004**: Every quota enforcement decision (denial or near-threshold allowance) produces a queryable verification record.
- **SC-005**: Audit queries from one tenant or workspace do not return records belonging to another tenant or workspace.
- **SC-006**: A superadmin can confirm audit coverage completeness without accessing tenant-specific function data.

## 5. Assumptions

- Tenant and workspace scoping, including authorization for audit access, already exists and is enforced across the product.
- Function versioning and rollback behavior (US-FN-03-T01) is available and produces identifiable version transitions that this feature can record.
- Quota guardrail enforcement (US-FN-03-T03) is available and produces identifiable enforcement decisions that this feature can record.
- The console backend path (US-FN-03-T04) already preserves actor and scope context, which this feature captures in audit records.
- An audit infrastructure or event backbone (e.g., Kafka) is available for recording and querying audit events.
- This feature does not introduce retention policies, archival, or compliance-specific export formats; those are treated as separate product concerns.

## 6. Scope Boundaries

### In scope

- Audit trail for function deployments (create, update, redeploy).
- Audit trail for administrative actions on functions (configuration changes, visibility changes, enable/disable, deletion).
- Rollback evidence records with version, actor, scope, and outcome details.
- Quota enforcement verification records for denials and near-threshold allowances.
- Scope-bounded audit access and cross-scope isolation.
- Superadmin governance coverage visibility.
- Filtered and time-bounded audit queries.
- Console backend path attribution in audit records.

### Out of scope

- `US-FN-03-T01`: Function versioning and rollback mechanics.
- `US-FN-03-T02`: Workspace secrets and secure secret references.
- `US-FN-03-T03`: Quota guardrail enforcement logic and quota posture visibility.
- `US-FN-03-T04`: Console backend execution in OpenWhisk consuming the same public APIs.
- `US-FN-03-T05`: Import/export of function and package definitions and web action visibility policies.
- Audit retention policies, archival strategies, compliance-specific export formats, or billing-related usage reporting.
- Runtime execution tracing, activation-level observability, or performance monitoring beyond audit evidence.
