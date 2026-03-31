# Feature Specification: Admin–Data Privilege Separation

**Feature Branch**: `094-admin-data-privilege-separation`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Separate permissions between structural administration and data access"  
**Traceability**: EP-18 / US-SEC-02 / US-SEC-02-T04 · RF-SEC-010, RF-SEC-011

## User Scenarios & Testing *(mandatory)*

### User Story 1 – Platform Team enforces least-privilege across roles (Priority: P1)

A platform team configures the BaaS so that users who manage structural resources (create tenants, define schemas, configure services, deploy functions) **cannot** read or write tenant application data through the same credentials or session, and vice-versa.

**Why this priority**: Without a hard separation between administrative and data-plane permissions, a compromised admin credential exposes all tenant data. This is the foundational security guarantee the feature delivers.

**Independent Test**: A platform operator assigns the "Structural Admin" role to a user. That user can create a database collection but **cannot** read, insert, update, or delete documents in any tenant collection. Conversely, a user with the "Data Operator" role can query documents but **cannot** create or drop collections.

**Acceptance Scenarios**:

1. **Given** a user holds only the "Structural Admin" role, **When** the user attempts to read documents from a tenant collection via the REST API, **Then** the request is denied with a 403 status and an audit event is recorded.
2. **Given** a user holds only the "Data Operator" role, **When** the user attempts to create a new database collection via the console, **Then** the action is denied with a clear error explaining insufficient structural privileges.
3. **Given** a user holds both "Structural Admin" and "Data Operator" roles, **When** the user performs structural and data operations, **Then** both succeed and each operation is logged under the corresponding privilege domain.

---

### User Story 2 – Tenant Owner reviews and assigns privilege domains (Priority: P1)

A tenant owner needs to grant fine-grained access to team members. They can assign structural-administration privileges (manage schemas, configure services, manage workspace settings) independently of data-access privileges (read/write application data, query analytics).

**Why this priority**: Tenant owners are the primary consumers of the role-assignment UX. If they cannot separately control structural vs. data permissions, the principle of least privilege cannot be enforced at the workspace level.

**Independent Test**: In the console, a tenant owner navigates to the workspace members page, selects a member, and sees two distinct privilege-domain sections. They can grant "Schema Management" under structural and "Read-Only Data" under data access independently. Changes are persisted and immediately enforced.

**Acceptance Scenarios**:

1. **Given** a tenant owner is on the workspace members page, **When** they view a member's permissions, **Then** structural privileges and data-access privileges are displayed as separate, clearly labelled sections.
2. **Given** a tenant owner assigns only structural privileges to a member, **When** that member logs in, **Then** the member can manage schemas and settings but cannot access tenant application data.
3. **Given** a tenant owner revokes data-access privileges from a member, **When** the member's next request touches application data, **Then** the request is denied and the member's console view no longer shows data-browsing capabilities.

---

### User Story 3 – Superadmin audits cross-domain privilege usage (Priority: P2)

A superadmin can query an audit log that distinguishes actions performed under structural-administration privileges from actions performed under data-access privileges, enabling compliance reviews and forensic analysis.

**Why this priority**: Auditability is a hard requirement for multi-tenant platforms but is secondary to the enforcement itself. Once separation is enforced (Stories 1 & 2), the audit trail provides oversight and accountability.

**Independent Test**: A superadmin queries the audit log filtering by privilege domain ("structural" or "data"). The results show only events matching the selected domain, with actor identity, resource, action, timestamp, and outcome (allow/deny).

**Acceptance Scenarios**:

1. **Given** a superadmin opens the audit query page, **When** they filter by privilege domain = "structural", **Then** only structural-administration events are listed with actor, resource, action, timestamp, and outcome.
2. **Given** several denied cross-domain attempts occurred in the last 24 hours, **When** the superadmin queries denials, **Then** each denial entry shows the attempted privilege domain, the actor's actual roles, and the denied resource.

---

### User Story 4 – API keys scoped to a single privilege domain (Priority: P2)

When creating an API key for programmatic access, the creator must specify whether the key grants structural-administration or data-access privileges (not both). This prevents a single leaked key from compromising both planes.

**Why this priority**: API keys are high-risk credentials used in automation and CI/CD. Limiting each key to one privilege domain reduces blast radius. Dependent on the domain model from Stories 1 & 2.

**Independent Test**: A user creates an API key selecting "Data Access" scope. The key can query application data but receives 403 when calling any structural endpoint. A second key created with "Structural Admin" scope behaves inversely.

**Acceptance Scenarios**:

1. **Given** a user creates an API key with scope "Data Access", **When** the key is used to call a structural-administration endpoint, **Then** the request returns 403 and an audit event is emitted.
2. **Given** a user creates an API key with scope "Structural Admin", **When** the key is used to read application data, **Then** the request returns 403 and an audit event is emitted.
3. **Given** a user attempts to create an API key with both privilege domains selected, **Then** the system rejects the request and explains that a key must belong to exactly one privilege domain.

---

### Edge Cases

- **What happens when a role mapping is changed while a session is active?** Active sessions must re-evaluate privileges on the next request or within a bounded propagation window (≤ 60 seconds). Stale grants must not persist indefinitely.
- **What happens when every structural admin is removed from a workspace?** The system must prevent the last structural-admin removal to avoid an unrecoverable workspace. A minimum of one structural admin per workspace is enforced.
- **What happens when a tenant owner attempts to self-escalate by assigning themselves data-access on a workspace they structurally administer?** This is allowed — the separation prevents *implicit* cross-domain access, not explicit dual-role assignment by an authorized owner.
- **What happens when a legacy API key (pre-separation) exists?** Migration must assign a default privilege domain based on the key's historical usage or flag the key for owner review within a configurable grace period.
- **How does privilege separation interact with Keycloak federation?** Privilege domains must map cleanly to Keycloak realm roles or composite roles, ensuring external IdP integrations respect the boundary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define exactly two top-level privilege domains: **Structural Administration** (resource lifecycle, configuration, schema management, deployment) and **Data Access** (read, write, query, delete application data).
- **FR-002**: Each permission within the platform MUST be classified under exactly one of the two privilege domains. No permission may span both domains.
- **FR-003**: The system MUST enforce privilege-domain boundaries at request time: a credential (session, token, or API key) that lacks the required domain MUST receive a 403 response.
- **FR-004**: The console MUST present privilege-domain assignment as two separate sections when managing workspace member permissions.
- **FR-005**: A tenant owner MUST be able to assign or revoke privileges in each domain independently for any workspace member.
- **FR-006**: The system MUST prevent removal of the last user holding structural-administration privileges in any workspace.
- **FR-007**: API key creation MUST require the creator to select exactly one privilege domain; keys spanning both domains MUST be rejected.
- **FR-008**: Every denied cross-domain access attempt MUST generate an audit event containing: actor identity, attempted action, target resource, privilege domain required, privilege domain held, timestamp, and denial reason.
- **FR-009**: The audit log MUST support filtering by privilege domain to enable domain-specific compliance queries.
- **FR-010**: When a user's privilege-domain assignment changes, enforcement MUST reflect the change within 60 seconds for all active sessions and tokens.
- **FR-011**: Existing API keys created before this feature MUST be migrated to a single privilege domain. Keys that cannot be automatically classified MUST be flagged for owner review.
- **FR-012**: The system MUST respect multi-tenant isolation: privilege-domain assignments in one tenant MUST NOT affect another tenant.

### Key Entities

- **Privilege Domain**: An enumerated classification ("structural_admin" | "data_access") attached to every platform permission, role, and API key scope.
- **Workspace Member Privilege Assignment**: The association between a workspace member and the set of permissions granted within each privilege domain. Scoped per workspace, per tenant.
- **API Key Domain Scope**: A mandatory, immutable attribute of each API key indicating which single privilege domain the key authorises.
- **Cross-Domain Denial Event**: An audit record generated whenever a request is blocked because the actor's credential does not carry the required privilege domain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % of platform permissions are classified into exactly one privilege domain before the feature is considered complete.
- **SC-002**: A credential limited to one privilege domain cannot access any resource in the other domain — verified by automated acceptance tests covering every public endpoint category.
- **SC-003**: Tenant owners can assign or revoke privilege-domain permissions for a workspace member in under 30 seconds through the console.
- **SC-004**: Cross-domain denial audit events are queryable by superadmins within 5 seconds of occurrence.
- **SC-005**: Privilege-domain changes propagate to active sessions within 60 seconds.
- **SC-006**: Legacy API keys are migrated or flagged for review within the first operational cycle after deployment, with zero keys left unclassified after the grace period.

## Assumptions

- Keycloak is the single source of truth for identity and role definitions; privilege-domain classification will be modelled as Keycloak realm roles or composite roles.
- The existing scope-enforcement APISIX plugin (093-scope-enforcement-blocking) can be extended to evaluate privilege-domain boundaries without a separate plugin.
- The existing API key rotation infrastructure (089-api-key-rotation) supports adding a mandatory domain-scope attribute to key creation.
- The audit backbone (Kafka + PostgreSQL) established in prior features (091, 092, 093) is available for cross-domain denial events.
- US-SEC-02-T01 (secure secret storage), US-SEC-02-T02 (secret rotation), and US-SEC-02-T03 (scope enforcement) are implemented or in progress; this feature depends on their enforcement primitives but does not re-implement them.

## Out of Scope

- Defining more than two privilege domains (e.g., adding a third "observability" domain) — this can be a future extension.
- Per-field or per-row data-access controls within a collection — this feature operates at the API-endpoint and resource-type level.
- Deployment-vs-execution function privilege separation — covered by US-SEC-02-T05.
- Hardening and penetration tests — covered by US-SEC-02-T06.
