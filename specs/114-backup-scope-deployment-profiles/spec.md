# Feature Specification: Backup Scope & Limits by Deployment Profile

**Feature Branch**: `114-backup-scope-deployment-profiles`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "Documentar alcance y límites del soporte de backup según perfil de despliegue"  
**Task ID**: US-BKP-01-T06  
**Epic**: EP-20 — Backup, recuperación y continuidad operativa  
**Story**: US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación

## User Scenarios & Testing *(mandatory)*

### User Story 1 - SRE Consults Backup Coverage Matrix per Deployment Profile (Priority: P1)

An SRE or platform operator needs to understand, for each deployment profile (all-in-one, standard, HA), exactly which managed components (PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, Keycloak, APISIX config) are covered by the platform's backup capabilities and which are not. This information must be accessible from within the product — either via API or documentation surface — without requiring external runbooks or tribal knowledge.

**Why this priority**: Without a clear backup coverage matrix tied to the deployment profile, operators cannot make informed disaster-recovery decisions. This is the foundational artifact upon which all other backup/restore tasks (T01–T05) depend.

**Independent Test**: Can be verified by deploying the platform under a given profile and confirming that the backup scope documentation accurately reflects which components report backup status and which are explicitly marked as out-of-scope or operator-managed.

**Acceptance Scenarios**:

1. **Given** the platform is deployed with the "standard" profile, **When** an SRE queries the backup scope documentation or API, **Then** they receive a per-component matrix indicating: backup availability (platform-managed / operator-managed / not-supported), granularity (full / incremental / config-only / none), and any preconditions or limitations.
2. **Given** the platform is deployed with the "all-in-one" profile, **When** an SRE queries the backup scope, **Then** the response clearly states that certain HA-only backup features are unavailable and explains why.
3. **Given** a component is deployed externally (e.g., managed PostgreSQL from a cloud provider), **When** the SRE queries backup scope, **Then** that component is listed as "operator-managed" with a note that backup responsibility lies outside the platform.

---

### User Story 2 - Superadmin Reviews Backup Limits Before Enabling Backup/Restore Actions (Priority: P1)

A superadmin about to enable or configure backup/restore actions for a tenant needs to understand the operational limits: maximum backup frequency, retention windows, concurrent backup jobs, size constraints, and any per-tenant or per-workspace restrictions that apply under the active deployment profile.

**Why this priority**: Limits directly affect whether backup/restore actions (T02) will succeed or be rejected. Publishing them prevents configuration errors and failed restore attempts.

**Independent Test**: Can be verified by reading the documented limits for a given profile and confirming that attempting to exceed them results in clear feedback (either at configuration time or at the API boundary).

**Acceptance Scenarios**:

1. **Given** the deployment profile is "HA", **When** the superadmin reviews backup limits, **Then** they see per-component limits including: maximum backup frequency, maximum retention period, maximum concurrent backup jobs, and any size-based restrictions.
2. **Given** a tenant has a plan that restricts backup features, **When** the superadmin queries backup limits for that tenant, **Then** plan-level restrictions are layered on top of deployment-profile limits and both are visible.
3. **Given** the deployment profile does not support backup for a particular component (e.g., OpenWhisk state in all-in-one), **When** the superadmin attempts to configure backup for it, **Then** the system returns a clear message stating backup is not available for that component under this profile.

---

### User Story 3 - Tenant Owner Understands Backup Scope for Their Resources (Priority: P2)

A tenant owner wants to know which of their resources (databases, collections, buckets, topics, functions) are covered by the platform's backup capabilities and what the recovery point objective (RPO) and recovery time objective (RTO) expectations are, so they can make informed decisions about additional external backups.

**Why this priority**: Tenant owners need transparency to plan their own data protection strategy. This is slightly lower priority because it depends on the operator-facing matrix (US1) being in place first.

**Independent Test**: Can be verified by a tenant owner accessing the backup scope information through the console or API and confirming it accurately reflects their resource coverage.

**Acceptance Scenarios**:

1. **Given** a tenant with PostgreSQL databases and S3 buckets, **When** they query the backup scope for their resources, **Then** they see per-resource-type coverage indicating whether platform backup is available, the expected RPO/RTO ranges, and any tenant-specific limitations.
2. **Given** a component is not backed up by the platform, **When** the tenant owner views their backup scope, **Then** a clear indication is shown that external backup is recommended, with no false sense of coverage.

---

### User Story 4 - Platform Team Publishes Updated Backup Scope After Profile Change (Priority: P3)

When the platform team upgrades the deployment profile (e.g., from standard to HA) or adds/removes a managed component, the backup scope documentation must be updated to reflect the new reality without manual intervention.

**Why this priority**: Operational hygiene — the backup scope should stay accurate over time. Lower priority because initial documentation is more urgent than drift detection.

**Independent Test**: Can be verified by changing the deployment profile in values and confirming that the backup scope information reflects the new profile's capabilities.

**Acceptance Scenarios**:

1. **Given** the platform is upgraded from "standard" to "HA" profile, **When** the backup scope is queried, **Then** the response reflects the expanded backup capabilities of the HA profile.
2. **Given** a previously-managed component is switched to external management, **When** the backup scope is queried, **Then** that component is reclassified as "operator-managed" in the backup scope.

---

### Edge Cases

- What happens when a deployment profile is partially configured (e.g., HA for PostgreSQL but all-in-one for Kafka)? The backup scope must reflect per-component profile reality, not a single global profile label.
- How does the system handle an unknown or custom deployment profile? It must degrade to reporting "unknown — operator verification required" rather than assuming coverage.
- What happens when backup infrastructure (e.g., a backup agent or scheduled job) is present in the profile but not yet operational? The scope must distinguish between "supported by profile" and "currently operational".
- What if the platform is deployed in an air-gapped environment where backup destinations may have additional constraints? The documentation must note air-gap-specific limitations where applicable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST provide a backup scope matrix that lists every managed component and its backup coverage status (platform-managed, operator-managed, not-supported) for each supported deployment profile (all-in-one, standard, HA).
- **FR-002**: The backup scope matrix MUST include, per component per profile: backup granularity (full, incremental, config-only, none), expected RPO range, expected RTO range, and any preconditions.
- **FR-003**: The platform MUST expose the backup scope matrix via a queryable API endpoint accessible to superadmin and SRE roles.
- **FR-004**: The platform MUST expose the backup scope matrix in the administrative console under a dedicated backup/recovery section.
- **FR-005**: The backup scope MUST document per-component operational limits including: maximum backup frequency, maximum retention period, maximum concurrent backup jobs, and size-based restrictions, parameterized by deployment profile.
- **FR-006**: When a component is deployed externally (operator-managed), the platform MUST classify it as "operator-managed" in the backup scope and MUST NOT claim backup coverage.
- **FR-007**: The backup scope MUST distinguish between "supported by deployment profile" and "currently operational" for each component's backup capability.
- **FR-008**: For tenant-facing consumers, the platform MUST expose a tenant-scoped view of backup coverage limited to the resource types the tenant actually uses, filtered by plan-level restrictions and deployment-profile capabilities.
- **FR-009**: The backup scope information MUST be derivable from the active deployment configuration (Helm values, feature flags, component health) without requiring manual documentation updates.
- **FR-010**: The platform MUST return a clear, structured error or informational response when a user queries backup scope for a component that is not supported under the active deployment profile.
- **FR-011**: All access to the backup scope API MUST be subject to authentication, role-based authorization, and tenant isolation (superadmin sees all; tenant owner sees only their tenant's coverage).
- **FR-012**: The platform MUST emit an audit event when the backup scope is queried by any actor, recording actor, tenant (if applicable), timestamp, and correlation-id.

### Key Entities

- **Deployment Profile**: Represents the operational configuration of the platform (all-in-one, standard, HA) that determines which components are managed, their redundancy, and which backup features are available.
- **Managed Component**: A platform-managed service (PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, Keycloak, APISIX) whose backup coverage is scoped by the deployment profile.
- **Backup Scope Entry**: A per-component, per-profile record describing: coverage status, granularity, RPO/RTO expectations, operational limits, and preconditions.
- **Tenant Backup View**: A tenant-scoped projection of the backup scope matrix, filtered by the resource types the tenant uses and any plan-level restrictions on backup features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can determine the backup coverage status of any managed component within 30 seconds of accessing the backup scope surface, without consulting external documentation.
- **SC-002**: 100% of managed components in each supported deployment profile have a documented backup scope entry — no component is left undocumented.
- **SC-003**: Tenant owners can view their resource-specific backup coverage within the console in under 3 clicks from the workspace dashboard.
- **SC-004**: When the deployment profile changes, the backup scope information reflects the new profile's capabilities within the next platform reconciliation cycle (no manual doc updates required).
- **SC-005**: Zero false-positive backup coverage claims — no component is listed as platform-managed backup when it is actually operator-managed or unsupported.

## Assumptions

- Deployment profiles (all-in-one, standard, HA) are already defined and available as platform configuration (per US-DEP-03-T04).
- The observability and health-check infrastructure (per US-OBS-01) provides the operational status signals needed to distinguish "supported by profile" from "currently operational".
- Plan-level restrictions on backup features exist or will exist as part of the plan/quota model (EP-19).
- The backup scope is an informational/documentation capability; it does not implement the actual backup/restore mechanisms (those are T01–T05).
- RPO and RTO values are expressed as ranges or expectations, not SLA guarantees, reflecting the best-effort nature of the platform's built-in backup support.

## Scope Boundaries

### In Scope

- Defining and exposing the backup scope matrix per deployment profile.
- API endpoint and console view for querying backup coverage.
- Tenant-scoped projection of backup scope.
- Audit of backup scope queries.
- Derivation of backup scope from active deployment configuration.

### Out of Scope

- Actual backup/restore execution (US-BKP-01-T01, T02).
- Audit of backup/restore actions (US-BKP-01-T03).
- Restore confirmations and prechecks (US-BKP-01-T04).
- Restore testing and simulation (US-BKP-01-T05).
- Configuration export/import (US-BKP-02).
- Defining or enforcing backup SLA guarantees.

## Dependencies

- **US-DEP-03**: Deployment profiles and their parameterization.
- **US-OBS-01**: Health checks and component operational status.
- **US-BKP-01-T01 through T05**: Sibling tasks that consume the backup scope matrix but are not implemented here.

## Risks

- If deployment profiles are not fully formalized yet, the backup scope matrix may need placeholder entries that are refined as profiles mature.
- RPO/RTO expectations depend on component-specific backup tooling that may not be fully validated at spec time; values should be treated as initial estimates.
