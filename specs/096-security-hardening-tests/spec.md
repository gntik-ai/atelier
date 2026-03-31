# Feature Specification: Security Hardening Tests for Secrets, Scopes and Plan-Restricted Routes

**Feature Branch**: `096-security-hardening-tests`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Crear pruebas de hardening para secretos, scopes inválidos y rutas restringidas por plan"  
**Traceability**: EP-18 / US-SEC-02 / US-SEC-02-T06 · RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

## User Scenarios & Testing *(mandatory)*

### User Story 1 – Platform security team validates that expired or revoked secrets cannot access protected resources (Priority: P1)

The platform team runs a suite of hardening tests that prove credentials which have been rotated, revoked, or whose grace period has expired are rejected at every entry point. These tests exercise the full lifecycle: a valid secret is used successfully, then rotated (new version active, old version in grace), then the grace period expires or the old version is explicitly revoked, and subsequent requests with the old secret fail with a clear denial. The tests cover API-key–based access, Vault-backed service credentials, and webhook signing secrets.

**Why this priority**: If stale or revoked secrets still grant access, the entire rotation infrastructure (US-SEC-02-T02) is security theatre. This is the single highest-risk gap to validate.

**Independent Test**: Execute the secret-lifecycle hardening suite against a running platform instance. All scenarios pass: valid secret → access granted; rotated-but-in-grace secret → access granted; post-grace or revoked secret → access denied with appropriate HTTP status and audit event.

**Acceptance Scenarios**:

1. **Given** a secret has been rotated and the grace period has expired, **When** a request is made using the old secret value, **Then** the request is denied with a 401/403 status and a denial audit event is recorded.
2. **Given** a secret has been explicitly revoked before its grace period ends, **When** a request is made using the revoked secret value, **Then** the request is denied immediately with a 401/403 status.
3. **Given** a secret is currently within its grace period after rotation, **When** a request is made using the old secret value, **Then** the request succeeds and the response includes an indicator that the credential is deprecated.
4. **Given** a webhook signing secret has been rotated, **When** a webhook delivery arrives signed with the old secret after grace expiry, **Then** the signature validation fails and the delivery is flagged.

---

### User Story 2 – Platform security team validates that invalid or insufficient scopes are denied at the gateway (Priority: P1)

The platform team runs hardening tests confirming that tokens or API keys with scopes that do not match the requirements of a given endpoint are denied before reaching the backend. The tests cover: missing required scope, scope from a different privilege domain, expired scope grant, and scope that was valid but has been removed from the endpoint requirements table.

**Why this priority**: Scope enforcement (US-SEC-02-T03) is the primary authorization boundary for every API call. A gap here means any authenticated caller can access any endpoint regardless of their role or plan.

**Independent Test**: Execute the scope-enforcement hardening suite. Each test case presents a token/API-key with specific scopes to an endpoint with known scope requirements and validates the expected accept/deny outcome, HTTP status code, and audit trail.

**Acceptance Scenarios**:

1. **Given** an endpoint requires scope `storage:write`, **When** a request arrives with a token that only has `storage:read`, **Then** the gateway denies the request with 403 and records a scope-denied audit event.
2. **Given** an endpoint requires scope `functions:deploy`, **When** a request arrives with a token that has `functions:invoke` (different privilege sub-domain), **Then** the request is denied with 403.
3. **Given** a token was issued with a valid scope that has since been removed from the endpoint's scope requirements, **When** a request arrives with that token, **Then** the request is denied (fail-closed behaviour) and a configuration-error audit event is emitted.
4. **Given** an endpoint has no scope requirement registered in the requirements table, **When** a request arrives with any authenticated token, **Then** the gateway denies the request (fail-closed) and emits a config-error event.

---

### User Story 3 – Platform security team validates that plan-restricted routes reject callers on lower-tier plans (Priority: P1)

The platform team runs hardening tests proving that endpoints gated by subscription plan (e.g., premium-only features, higher-tier storage operations) correctly deny access to tenants whose active plan does not include the required capability, and that the denial is clear and auditable.

**Why this priority**: Plan-based route restriction is a commercial and security boundary. If tenants on a free or basic plan can reach premium endpoints, it creates revenue leakage and potential abuse vectors.

**Independent Test**: Execute the plan-restriction hardening suite. Tests present tokens from tenants on various plan tiers to plan-gated endpoints and verify correct accept/deny behaviour, HTTP status, and audit events.

**Acceptance Scenarios**:

1. **Given** an endpoint is restricted to the "enterprise" plan, **When** a tenant on the "free" plan makes a request, **Then** the gateway denies the request with 403 and a plan-denied audit event is recorded.
2. **Given** an endpoint is restricted to the "professional" plan, **When** a tenant on the "enterprise" plan makes a request, **Then** the request is allowed (enterprise is a superset).
3. **Given** a tenant's plan was recently downgraded from "enterprise" to "free", **When** the tenant accesses a previously available enterprise endpoint, **Then** the request is denied within the plan-cache TTL window and an audit event is recorded.
4. **Given** an endpoint's plan restriction is misconfigured (references a non-existent plan tier), **When** any request arrives, **Then** the gateway denies the request (fail-closed) and emits a configuration-error event.

---

### User Story 4 – Platform security team validates privilege-domain boundary enforcement across admin and data domains (Priority: P2)

The platform team runs hardening tests confirming that the structural-admin / data-access privilege domain separation (US-SEC-02-T04) and the function deploy / execute separation (US-SEC-02-T05) are correctly enforced. Tests verify that a credential scoped to one domain cannot perform operations in the other, and that boundary crossings are denied and audited.

**Why this priority**: Privilege-domain separation reduces blast radius from compromised credentials. Without hardening tests, enforcement regressions could go unnoticed until an incident.

**Independent Test**: Execute the privilege-domain hardening suite. Tests present credentials with specific domain assignments to endpoints in the opposite domain and verify denial, correct HTTP status, and audit trail.

**Acceptance Scenarios**:

1. **Given** a credential is scoped to `data_access` only, **When** it attempts a `structural_admin` operation (e.g., workspace configuration change), **Then** the request is denied with 403 and a privilege-domain-denied audit event is recorded.
2. **Given** a credential is scoped to `structural_admin` only, **When** it attempts to read application data, **Then** the request is denied with 403.
3. **Given** a credential has the "Function Deployer" privilege but not "Function Invoker", **When** it attempts to invoke a function, **Then** the request is denied with 403 and a function-privilege-denied audit event is recorded.
4. **Given** a credential has both domain privileges, **When** it performs operations in each domain, **Then** both operations succeed and are individually audited under the correct domain.

---

### User Story 5 – Security team validates multi-tenant isolation in hardening test scenarios (Priority: P2)

The platform team runs cross-tenant hardening tests confirming that a valid, fully-scoped credential from Tenant A cannot access resources belonging to Tenant B, even when the scopes, plan tier, and privilege domains would otherwise permit the operation within the correct tenant boundary.

**Why this priority**: Multi-tenant isolation is the foundational security invariant. If any hardening test inadvertently passes cross-tenant, it signals a critical vulnerability.

**Independent Test**: Execute the tenant-isolation hardening suite. Tests present valid credentials from one tenant against resource endpoints belonging to a different tenant and verify denial.

**Acceptance Scenarios**:

1. **Given** a fully privileged credential from Tenant A, **When** it attempts to access a secret belonging to Tenant B, **Then** the request is denied with 403 and a workspace-mismatch audit event is recorded.
2. **Given** a fully privileged credential from Tenant A, **When** it attempts to invoke a function in Tenant B's workspace, **Then** the request is denied with 403.
3. **Given** a superadmin credential (cross-tenant access), **When** it accesses resources in any tenant, **Then** the access succeeds and is logged with the superadmin actor identity.

---

### User Story 6 – Hardening test results are reported in a structured, actionable format (Priority: P3)

After each hardening test run, the platform team receives a structured report summarizing passed tests, failed tests (with details on what was expected vs. observed), and a severity classification for each failure. The report can be consumed by CI/CD pipelines and security dashboards.

**Why this priority**: Without structured reporting, test results are difficult to triage and track over time. This is an enabler for continuous security validation but not a blocker for initial hardening coverage.

**Independent Test**: Run the full hardening suite and verify that a structured report is produced with pass/fail counts, individual test details, severity levels, and timestamps.

**Acceptance Scenarios**:

1. **Given** the hardening test suite has completed, **When** the report is generated, **Then** it includes a summary section with total passed, failed, and skipped counts.
2. **Given** a hardening test has failed, **When** the failure detail is inspected in the report, **Then** it shows the test identifier, category (secrets/scopes/plan/privilege-domain/tenant-isolation), expected outcome, actual outcome, and severity classification.
3. **Given** the hardening suite runs in a CI/CD pipeline, **When** any P1-category test fails, **Then** the pipeline exits with a non-zero code.

---

### Edge Cases

- What happens when the hardening suite runs against a platform instance where scope enforcement is in observation mode (`SCOPE_ENFORCEMENT_ENABLED=false`)? The tests must detect the mode and report scope-related tests as "skipped – enforcement disabled" rather than false passes.
- What happens when the hardening suite runs against a platform instance where privilege-domain enforcement is in observation mode (`PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false`)? Similar: tests detect the mode and report as "skipped – enforcement disabled".
- What happens when the Vault instance is unreachable during secret-lifecycle hardening tests? The tests that depend on Vault should fail gracefully with a clear "infrastructure unavailable" status rather than producing misleading security results.
- What happens when the plan-cache TTL causes a delay between plan downgrade and enforcement? The tests must account for the TTL window and either wait for expiry or bypass cache to test enforcement directly.
- What happens when hardening tests are run concurrently by multiple CI pipelines? Tests must use isolated tenant/workspace fixtures to avoid cross-contamination of results.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a hardening test suite that validates secret lifecycle enforcement: fresh secrets accepted, rotated secrets in-grace accepted, post-grace and revoked secrets denied.
- **FR-002**: The system MUST provide hardening tests that validate scope enforcement at the gateway: requests with missing, insufficient, or mismatched scopes are denied before reaching the backend.
- **FR-003**: The system MUST provide hardening tests that validate plan-restricted route enforcement: requests from tenants on ineligible plans are denied at the gateway.
- **FR-004**: The system MUST provide hardening tests that validate privilege-domain boundary enforcement: structural-admin credentials cannot perform data-access operations and vice versa.
- **FR-005**: The system MUST provide hardening tests that validate function deploy/execute privilege separation: deploy-only credentials cannot invoke functions and invoke-only credentials cannot deploy.
- **FR-006**: The system MUST provide hardening tests that validate multi-tenant isolation: credentials from one tenant cannot access resources of another tenant.
- **FR-007**: Each hardening test MUST verify that a corresponding audit event is emitted for every denial, including the actor, resource, denied action, timestamp, and reason.
- **FR-008**: The hardening test suite MUST detect when enforcement features are in observation/disabled mode and report affected tests as "skipped" with an explanation, preventing false-positive security assessments.
- **FR-009**: The hardening test suite MUST produce a structured report with per-test pass/fail/skip status, category, severity classification, and summary statistics.
- **FR-010**: The hardening test suite MUST exit with a non-zero code when any P1-severity test fails, enabling CI/CD gate integration.
- **FR-011**: Each hardening test MUST use isolated tenant and workspace fixtures to ensure tests can run concurrently without cross-contamination.
- **FR-012**: The hardening test suite MUST validate fail-closed behaviour: endpoints with missing scope requirements or invalid plan-tier references must deny all requests.

### Key Entities

- **Hardening Test Case**: Represents an individual security validation scenario with a category (secrets, scopes, plan, privilege-domain, tenant-isolation), severity (P1/P2/P3), preconditions, action, and expected outcome.
- **Hardening Test Report**: An aggregate result from a test run containing summary statistics, per-test results, timestamps, environment metadata (enforcement mode flags), and CI exit code.
- **Test Fixture**: An isolated tenant/workspace/credential set provisioned for a specific hardening test run, designed for concurrent execution safety.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The hardening suite covers 100% of the denial categories defined in US-SEC-02 (secret revocation, scope enforcement, plan restriction, privilege-domain separation, function deploy/execute separation, tenant isolation).
- **SC-002**: Every hardening test that expects a denial verifies both the HTTP response status and the presence of a corresponding audit event within 5 seconds.
- **SC-003**: The complete hardening suite executes in under 10 minutes on a standard platform deployment.
- **SC-004**: When a P1 hardening test fails, the CI/CD pipeline is blocked from proceeding within the same run.
- **SC-005**: The hardening suite correctly reports "skipped" (not false-pass) for 100% of tests whose corresponding enforcement feature flag is disabled.
- **SC-006**: Concurrent execution of the hardening suite by two independent CI pipelines produces no cross-contaminated or flaky results.

## Assumptions

- The platform instance under test has all prerequisite security features deployed (US-SEC-02-T01 through US-SEC-02-T05) even if some are in observation mode.
- Audit events are queryable within 5 seconds of the triggering action via existing audit query endpoints.
- The test runner has superadmin-level access to provision and tear down test fixtures (tenants, workspaces, credentials, secrets).
- Plan tier hierarchy is well-defined: enterprise ⊃ professional ⊃ basic ⊃ free.
- Kafka topics for audit events are available and consuming within the test environment.
