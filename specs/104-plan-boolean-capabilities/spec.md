# Feature Specification: Plan Boolean Capabilities

**Feature Branch**: `104-plan-boolean-capabilities`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Implementar capabilities booleanas por plan: SQL admin API, passthrough admin, realtime, webhooks, funciones públicas, etc."  
**Task ID**: US-PLAN-02-T02  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo  
**Depends on**: US-PLAN-01 (097–099), US-PLAN-02-T01 (103-hard-soft-quota-overrides)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Superadmin Defines Boolean Capabilities for a Product Plan (Priority: P1)

A superadmin configures which product capabilities are enabled or disabled for a given plan. Capabilities are boolean (on/off) and represent qualitative features of the platform — e.g., whether a tenant can use the SQL admin API, the passthrough admin proxy, realtime subscriptions, outbound webhooks, or public serverless functions. Each capability is drawn from a governed catalog of recognized capability keys maintained by the platform. A plan may enable any subset of recognized capabilities; capabilities not explicitly enabled on a plan are treated as disabled by default.

**Why this priority**: Without the ability to declare which capabilities a plan includes, plans can only differentiate by numeric quotas. Boolean capabilities are essential for tiered product packaging where higher plans unlock qualitatively different features, not just higher limits.

**Independent Test**: Can be fully tested by creating a plan, enabling a set of capabilities, querying the plan's capability profile, and verifying the enabled/disabled state of each recognized capability.

**Acceptance Scenarios**:

1. **Given** the `starter` plan exists, **When** the superadmin enables capabilities `realtime` and `webhooks` on this plan, **Then** both capabilities are persisted as enabled and all other recognized capabilities are treated as disabled for this plan.
2. **Given** the `professional` plan exists with `realtime`, `webhooks`, and `sql_admin_api` enabled, **When** the superadmin queries the plan's capability profile, **Then** the response lists every recognized capability with its enabled/disabled state for this plan.
3. **Given** the superadmin attempts to enable a capability key `nonexistent_feature` that is not in the recognized capability catalog, **Then** the request is rejected with an error indicating the capability key is invalid.
4. **Given** the `starter` plan has `webhooks` enabled, **When** the superadmin disables `webhooks` on the `starter` plan, **Then** the capability is persisted as disabled and an audit event is recorded.

---

### User Story 2 — Platform Maintains a Recognized Capability Catalog (Priority: P1)

The platform maintains a governed catalog of recognized boolean capabilities that plans may reference. Each capability has a unique key, a human-readable display label, a description of what it controls, and a platform default (enabled or disabled when a plan does not explicitly set it). The catalog serves as the single source of truth for which qualitative features can be governed by plans.

**Why this priority**: A governed catalog prevents arbitrary or misspelled capability keys from entering the system. It is the structural counterpart to the quota dimension catalog and must exist before capability assignment is meaningful.

**Independent Test**: Can be fully tested by querying the capability catalog and verifying it includes all expected platform capabilities with correct metadata.

**Acceptance Scenarios**:

1. **Given** the platform is initialized, **When** a superadmin queries the capability catalog, **Then** the response includes at minimum the following capabilities: `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`.
2. **Given** each capability in the catalog, **Then** it has a unique key, a display label (e.g., "SQL Admin API"), a description (e.g., "Enables direct SQL admin access to the tenant's PostgreSQL databases"), and a platform default value (enabled or disabled).
3. **Given** the catalog is used for plan capability validation, **When** a superadmin attempts to enable a capability key not present in the catalog, **Then** the operation is rejected with a descriptive error.
4. **Given** a new platform feature is added in a future release, **When** the platform team adds a new capability to the catalog, **Then** existing plans are unaffected — the new capability defaults to its platform default value for all plans that do not explicitly configure it.

---

### User Story 3 — Superadmin Reviews a Plan's Full Capability Profile (Priority: P2)

A superadmin or product operations user views the complete capability profile for a plan: a list of every recognized capability and whether it is explicitly enabled, explicitly disabled, or inheriting its platform default on this plan. This allows comparison between plan tiers and verification of commercial packaging.

**Why this priority**: Visibility into the capability profile is essential for correct plan packaging and tier comparison, but it depends on the catalog and capability assignment being in place first.

**Independent Test**: Can be fully tested by querying the capability profile for a plan and verifying all capabilities are returned with their effective state and source (explicit or default).

**Acceptance Scenarios**:

1. **Given** the `professional` plan explicitly enables `realtime`, `webhooks`, `sql_admin_api`, and `public_functions`, **When** the superadmin queries the plan's capability profile, **Then** the response lists every recognized capability, showing the four as explicitly enabled and all others as disabled (or inheriting platform default), with a clear indicator of the source (explicit plan configuration vs. platform default).
2. **Given** the superadmin queries capability profiles for both `starter` and `enterprise` plans, **Then** the responses are structurally identical and can be compared capability by capability to see tier differentiation.

---

### User Story 4 — Tenant Owner Views Their Effective Capabilities (Priority: P2)

A tenant owner queries the capabilities effectively available to their tenant. The response reflects the tenant's currently assigned plan's capability profile, showing which features are enabled and which are not. The tenant owner does not see internal capability keys or catalog metadata — only user-friendly labels and enabled/disabled state.

**Why this priority**: Tenants need to know what features are available under their plan to make informed usage and upgrade decisions. This visibility is secondary to the administrative configuration but critical for self-service.

**Independent Test**: Can be fully tested by authenticating as a tenant owner, querying effective capabilities, and verifying the response matches the assigned plan's capability profile.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `professional` plan which enables `realtime`, `webhooks`, `sql_admin_api`, and `public_functions`, **When** the tenant owner queries their effective capabilities, **Then** the response lists each capability with a display label and enabled/disabled state, matching the plan's configuration.
2. **Given** tenant `acme-corp` has no plan assigned, **When** the tenant owner queries their effective capabilities, **Then** the response indicates no plan is assigned and all capabilities default to the platform default behavior.
3. **Given** the tenant owner for `acme-corp` queries capabilities, **Then** the response does NOT include capabilities from other tenants' plans or any internal catalog metadata visible only to superadmins.

---

### User Story 5 — Capabilities Are Audited on Every Change (Priority: P2)

Every modification to a plan's capabilities — enabling, disabling, or changing which capabilities are set — is recorded as an audit event with the actor, timestamp, plan, capability key, previous state, and new state.

**Why this priority**: Auditability is non-negotiable for governance and compliance, but it is a supporting concern that builds on top of the capability management itself.

**Independent Test**: Can be fully tested by enabling and disabling capabilities on a plan and verifying that each change produces a queryable audit record with correct metadata.

**Acceptance Scenarios**:

1. **Given** the superadmin enables `webhooks` on the `starter` plan, **Then** an audit event is recorded with the actor, timestamp, plan identifier, capability key `webhooks`, previous state `disabled`, and new state `enabled`.
2. **Given** the superadmin disables `realtime` on the `professional` plan, **Then** an audit event is recorded with previous state `enabled` and new state `disabled`.
3. **Given** a plan's capability change history is queried, **Then** the results are returned in chronological order with all audit fields populated.

---

### Edge Cases

- What happens when a plan is transitioned to `deprecated` or `archived` while capabilities are configured? Capabilities remain as-is — they continue to apply to tenants still assigned that plan. Modification of capabilities on deprecated/archived plans follows the same lifecycle rules as quota dimension modifications (blocked for archived plans, audited for deprecated).
- What happens when a capability is removed from the catalog while some plans still reference it? The capability becomes "orphaned" — it is still present in those plans' configuration but has no effect on enforcement since enforcement only recognizes catalog-listed capabilities. Querying a plan's capability profile marks such capabilities as `deprecated_key` so admins can clean them up.
- What happens when a tenant's plan is changed from a plan with `realtime` enabled to one without it? The tenant's effective capabilities immediately reflect the new plan — `realtime` becomes disabled. Already-active realtime connections or resources are not retroactively terminated by this feature (that is the domain of US-PLAN-02-T05: gateway/UI enforcement).
- What happens if a superadmin sets a capability to its current state (e.g., enables an already-enabled capability)? The system treats it as a no-op — no audit event is emitted and no data is modified.
- What happens when two superadmins concurrently modify capabilities for the same plan? Standard optimistic concurrency applies: the first write succeeds, the second receives a conflict error and must retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain a governed catalog of recognized boolean capability keys, each with a unique key, display label, description, and platform default value (enabled or disabled).
- **FR-002**: The initial capability catalog MUST include at minimum: `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`.
- **FR-003**: The system MUST support enabling or disabling individual capabilities on a plan by referencing recognized capability keys from the catalog.
- **FR-004**: Capabilities not explicitly configured on a plan MUST inherit their platform default value from the capability catalog.
- **FR-005**: The system MUST reject attempts to enable or disable capability keys that are not present in the recognized capability catalog.
- **FR-006**: The system MUST provide a query API that returns the full capability profile for a plan, showing every recognized capability with its effective state (enabled/disabled) and source (explicit plan configuration or platform default).
- **FR-007**: The system MUST provide a query API for a tenant's effective capabilities, resolved from the tenant's currently assigned plan's capability profile.
- **FR-008**: Tenant-facing capability queries MUST include display-friendly labels and MUST NOT expose internal catalog metadata or other tenants' data.
- **FR-009**: Every capability change (enable or disable) on a plan MUST be recorded as an audit event with actor, timestamp, plan identifier, capability key, previous state, and new state.
- **FR-010**: No-op changes (setting a capability to its current state) MUST NOT produce audit events or data modifications.
- **FR-011**: Capability modifications MUST be permitted on `draft` and `active` plans. On `active` plans, every change MUST be audited. On `deprecated` plans, changes are permitted but audited. On `archived` plans, capability modifications MUST be blocked.
- **FR-012**: Capability configuration MUST be scoped per plan — every plan has its own independent set of enabled/disabled capabilities.
- **FR-013**: The system MUST emit a Kafka event for every capability change on a plan, including the plan identifier, capability key, previous and new state, and actor.
- **FR-014**: Only superadmin actors MUST be permitted to modify capabilities on plans or manage the capability catalog.
- **FR-015**: Tenant owners MUST be permitted to query their own tenant's effective capabilities (read-only).
- **FR-016**: The capability catalog MUST be extensible — adding new capabilities in future releases MUST NOT require modifying existing plans. New capabilities inherit their platform default for all plans that do not explicitly configure them.
- **FR-017**: If a capability key is removed from the catalog, plans that still reference it MUST flag the capability as orphaned in query responses, and the orphaned capability MUST have no enforcement effect.

### Key Entities

- **Capability Catalog Entry**: A recognized boolean capability the platform supports. Carries a unique key, display label, description, and platform default value (enabled/disabled). Analogous to the quota dimension catalog but for qualitative features.
- **Plan Capability Configuration**: The per-plan, per-capability explicit setting (enabled or disabled). Only capabilities explicitly configured are stored; unset capabilities inherit the platform default from the catalog.
- **Effective Capability Profile**: The computed view of a plan's capabilities, merging explicit plan configuration with catalog defaults for all recognized capabilities. This is what tenants and admins see.
- **Capability Audit Event**: A record of a capability change on a plan, including actor, timestamp, plan, capability key, previous state, and new state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Superadmins can enable or disable any recognized capability on a plan and the change is reflected in capability profile queries within the same operational cycle.
- **SC-002**: A tenant owner querying their effective capabilities sees a complete list matching their assigned plan's capability profile, with display-friendly labels and no internal metadata leakage.
- **SC-003**: Every capability change on a plan produces a queryable audit event within 30 seconds of the change.
- **SC-004**: The capability catalog contains at minimum 7 recognized capabilities at platform initialization, and adding a new capability does not require modifying any existing plan.
- **SC-005**: Attempting to use an unrecognized capability key is rejected in all capability management operations, with a clear error message.
- **SC-006**: Capability profiles for different plans can be compared side-by-side (structurally identical response schemas) to verify tier differentiation.
- **SC-007**: No cross-tenant data leakage occurs: a tenant's effective capabilities are invisible to other tenants.
- **SC-008**: Capabilities on archived plans cannot be modified; the system rejects such requests with a clear error.

## Assumptions

- The `plans` table and plan lifecycle management from specs 097–099 are deployed and operational before this feature is activated.
- The plan audit infrastructure (audit events table and Kafka audit pipeline) from previous plan specs is available for extension with new `capability.enabled` and `capability.disabled` event types.
- The initial set of 7 capability keys corresponds to platform features that already exist or are being developed in parallel — the capability catalog does not create or implement those features, only governs their availability per plan.
- Capability enforcement (actually blocking access to disabled capabilities at the gateway, UI, or control plane) is out of scope for this task and deferred to US-PLAN-02-T05.
- The capability catalog is seeded during platform initialization (migration or bootstrap) and is managed operationally by superadmins thereafter.
- Boolean capabilities do not carry numeric values, grace margins, or soft/hard distinctions — they are strictly on/off. Numeric resource governance remains in the quota dimension system (098, 103).

## Scope Boundaries

### In scope

- Governed boolean capability catalog with recognized keys, labels, descriptions, and platform defaults.
- Per-plan capability configuration (enable/disable individual capabilities).
- Capability profile query for plans (superadmin).
- Effective capabilities query for tenants (tenant owner, read-only).
- Audit events for every capability change on a plan.
- Kafka events for capability lifecycle changes.
- Lifecycle-aware modification rules (draft/active/deprecated/archived).
- Orphaned capability handling when catalog entries are removed.

### Out of scope

- Hard/soft quotas and numeric overrides (US-PLAN-02-T01, already specified in 103).
- Effective limit calculation combining workspace-level sub-quotas (US-PLAN-02-T03).
- Console visualization of capabilities and consumption (US-PLAN-02-T04).
- Gateway/UI enforcement of boolean capabilities — blocking or hiding features based on capability state (US-PLAN-02-T05).
- End-to-end enforcement tests across all services (US-PLAN-02-T06).
- Per-tenant capability overrides (not in current story scope; would be a future extension analogous to quota overrides).
- Implementation of the underlying features themselves (realtime, webhooks, etc.) — this task only governs their availability per plan.
