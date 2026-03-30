# Feature Specification: Workspace Capability Catalog

**Feature Branch**: `090-workspace-capability-catalog`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Exponer catálogo de capacidades habilitadas por workspace y ejemplos para Postgres, Mongo, eventos, realtime, functions y storage"  
**Task ID**: US-DX-02-T06  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Discovers Workspace Capabilities (Priority: P1)

A developer integrating with a workspace needs to quickly understand which platform capabilities (PostgreSQL, MongoDB, event streaming, realtime subscriptions, serverless functions, object storage) are enabled for their workspace. They access a capability catalog that lists all available capabilities with their current status (enabled/disabled), along with quick-start examples for each enabled capability. This removes guesswork and prevents failed API calls to disabled services.

**Why this priority**: This is the core value proposition — without knowing what capabilities are available, developers cannot effectively integrate. This directly addresses the acceptance criterion of "minimal friction integration."

**Independent Test**: Can be fully tested by requesting the capability catalog for a workspace and verifying it accurately reflects the workspace's enabled capabilities with appropriate usage examples.

**Acceptance Scenarios**:

1. **Given** a workspace with PostgreSQL, realtime, and functions enabled but MongoDB and storage disabled, **When** a developer requests the capability catalog, **Then** the catalog returns all six capability categories with their correct enabled/disabled status, and usage examples are provided only for the three enabled capabilities.
2. **Given** a workspace with all capabilities enabled, **When** a developer requests the capability catalog, **Then** the catalog returns all capabilities as enabled with usage examples for each one.
3. **Given** a workspace with no capabilities enabled beyond the base platform, **When** a developer requests the capability catalog, **Then** the catalog returns all capabilities as disabled with no usage examples, and includes guidance on how to request capability enablement.

---

### User Story 2 - Developer Accesses Capability-Specific Examples (Priority: P1)

A developer who has identified an enabled capability in the catalog wants to see practical, contextualised examples showing how to use that capability within their workspace. Examples include the workspace's base URL, relevant endpoint patterns, expected request/response shapes, and common operations (CRUD for data stores, publish/subscribe for events and realtime, invoke for functions, upload/download for storage).

**Why this priority**: Examples are the primary tool for reducing integration friction. A capability list without actionable examples still leaves developers guessing.

**Independent Test**: Can be tested by requesting examples for a specific enabled capability and verifying the examples are contextualised to the workspace (correct base URL, workspace-scoped endpoints) and cover common operations.

**Acceptance Scenarios**:

1. **Given** a workspace with PostgreSQL enabled, **When** a developer requests examples for the PostgreSQL capability, **Then** the system returns examples covering at minimum: connecting, querying, inserting, and listing tables — all scoped to the workspace's context.
2. **Given** a workspace with realtime enabled, **When** a developer requests examples for the realtime capability, **Then** the system returns examples covering at minimum: subscribing to a channel, receiving messages, and unsubscribing — scoped to the workspace.
3. **Given** a workspace where MongoDB is disabled, **When** a developer requests examples for MongoDB, **Then** the system returns a clear message that MongoDB is not enabled for this workspace and indicates how to request enablement.

---

### User Story 3 - Workspace Admin Reviews Capability Status (Priority: P2)

A workspace admin or tenant owner wants to review which capabilities are enabled across their workspaces to plan capacity, understand costs, and ensure the right services are available for their development teams. The catalog provides a summary view that can be consumed programmatically or through the console.

**Why this priority**: While developers are the primary consumers, admins need visibility into capability allocation for governance and planning purposes.

**Independent Test**: Can be tested by an admin accessing the capability catalog for a workspace they manage and verifying the status summary matches the actual provisioned state.

**Acceptance Scenarios**:

1. **Given** a workspace admin with access to two workspaces with different capability configurations, **When** the admin requests the capability catalog for each workspace, **Then** each catalog accurately reflects the distinct capability configuration of that workspace.
2. **Given** a tenant owner, **When** they request the capability catalog for a workspace, **Then** the response includes the capability status and any relevant quota or limit information associated with each enabled capability.

---

### User Story 4 - Integrator Discovers Capabilities Programmatically (Priority: P2)

An external integrator building tooling or automation against the platform needs to discover workspace capabilities programmatically. The capability catalog is available through a stable, documented endpoint that returns structured data suitable for machine consumption (not just human-readable documentation).

**Why this priority**: Programmatic discovery enables tooling ecosystems and automated integrations, extending the platform's developer experience beyond manual exploration.

**Independent Test**: Can be tested by making an API call to the capability catalog endpoint and verifying the response is structured data with a stable schema that includes capability identifiers, enabled status, and metadata.

**Acceptance Scenarios**:

1. **Given** an authenticated integrator with valid workspace credentials, **When** they call the capability catalog endpoint, **Then** the response is structured data containing an array of capabilities, each with at minimum: a unique identifier, display name, category, enabled status, and version information.
2. **Given** an unauthenticated request, **When** the capability catalog endpoint is called, **Then** the system rejects the request with an appropriate authentication error.

---

### Edge Cases

- What happens when a capability is in a transitional state (being provisioned or deprovisioned)? The catalog should reflect the transitional state (e.g., "provisioning", "deprovisioning") rather than incorrectly showing enabled or disabled.
- What happens when the underlying service for a capability is temporarily unavailable? The catalog should still report the capability as enabled (since it is configured) but may include a health indicator if health status is available.
- What happens when a new capability type is added to the platform but not yet reflected in any workspace's configuration? The catalog should include the new capability as "not available" or omit it until it is configurable.
- What happens when a developer requests the catalog for a workspace they do not have access to? The system must return an authorization error without revealing whether the workspace exists.
- What happens when the workspace has capabilities enabled but the tenant-level quota for that capability has been exhausted? The catalog should show the capability as enabled but indicate quota constraints if applicable.
- What happens when examples reference features that depend on another capability (e.g., storage event notifications depend on event streaming)? Examples should note cross-capability dependencies clearly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a capability catalog endpoint that returns the list of all known platform capabilities and their enabled/disabled status for a given workspace.
- **FR-002**: System MUST scope all capability catalog responses to the authenticated user's workspace, enforcing workspace-level and tenant-level access controls.
- **FR-003**: System MUST return structured, machine-readable data (with stable schema) from the capability catalog endpoint, including at minimum: capability identifier, display name, category, enabled status, and version.
- **FR-004**: System MUST provide contextualised usage examples for each enabled capability, scoped to the requesting workspace (including workspace base URL, workspace-scoped endpoint patterns, and common operations).
- **FR-005**: System MUST cover examples for all six core capability categories: PostgreSQL, MongoDB, event streaming, realtime subscriptions, serverless functions, and object storage.
- **FR-006**: System MUST NOT return usage examples for capabilities that are disabled in the workspace; instead, it MUST return a clear indication that the capability is not enabled and guidance on enablement.
- **FR-007**: System MUST reflect transitional capability states (provisioning, deprovisioning) accurately in the catalog rather than showing a stale enabled/disabled value.
- **FR-008**: System MUST enforce authentication on the capability catalog endpoint; unauthenticated requests MUST be rejected.
- **FR-009**: System MUST enforce authorization so that users can only view the catalog for workspaces they have access to, without revealing the existence of other workspaces.
- **FR-010**: System MUST include tenant/workspace-level quota or limit information for enabled capabilities when such information is available.
- **FR-011**: System MUST emit an audit event when the capability catalog is accessed, including the workspace identifier, requesting user, and timestamp.
- **FR-012**: System MUST note cross-capability dependencies in examples (e.g., storage event notifications require event streaming to be enabled).
- **FR-013**: System MUST support catalog retrieval for the full workspace (all capabilities) and for a single specified capability.

### Key Entities

- **Capability**: Represents a platform service category (e.g., PostgreSQL, MongoDB, event streaming, realtime, functions, storage). Attributes include: unique identifier, display name, category, description, version, and a set of common operations.
- **Workspace Capability Status**: The association between a workspace and a capability, indicating whether it is enabled, disabled, or in a transitional state (provisioning/deprovisioning). May include quota or limit metadata.
- **Capability Example**: A contextualised usage snippet for a specific capability within a specific workspace. Contains: operation name, description, request pattern (method, path template, body shape), and expected response shape. Scoped to the workspace's base URL and configuration.
- **Capability Dependency**: A declared relationship between capabilities where one capability's features depend on another being enabled (e.g., storage event notifications depend on event streaming).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with no prior platform knowledge can identify all enabled capabilities for their workspace and access a working example for any enabled capability within 2 minutes of first accessing the catalog.
- **SC-002**: The capability catalog accurately reflects the real-time provisioning state of all capabilities for a workspace — no stale or incorrect status is shown when capabilities are enabled, disabled, or transitioning.
- **SC-003**: 100% of capability catalog requests enforce workspace-scoped access control — no user can view capabilities for a workspace they are not authorized to access.
- **SC-004**: The capability catalog covers all six core capability categories (PostgreSQL, MongoDB, event streaming, realtime subscriptions, serverless functions, object storage) with at least three contextualised examples per enabled capability.
- **SC-005**: Every access to the capability catalog generates an auditable record that can be retrieved through the platform's audit trail.
- **SC-006**: External integrators can programmatically discover and parse workspace capabilities using the structured catalog response without requiring human interpretation of documentation.

## Assumptions

- The workspace provisioning system already tracks which capabilities are enabled/disabled per workspace, and this state is queryable.
- Authentication and authorization infrastructure (Keycloak + APISIX) is already in place and provides workspace-scoped identity context.
- The audit event infrastructure (Kafka-based) is operational and can receive catalog access events.
- Workspace base URLs and endpoint patterns are deterministic and derivable from workspace configuration.
- The six core capability categories (PostgreSQL, MongoDB, event streaming, realtime, functions, storage) represent the complete set of catalogable capabilities at this stage; additional categories may be added in future iterations.
- Cross-capability dependency information is maintained as part of the platform's capability metadata and does not need to be discovered dynamically.

## Dependencies

- **US-DX-02-T03** (Workspace documentation generation): The capability catalog complements per-workspace documentation. The catalog focuses on capability discovery and examples, while T03 focuses on comprehensive documentation including credentials and full endpoint lists.
- **US-DX-02-T04** (OpenAPI/SDK publishing): The capability catalog's structured data may feed into OpenAPI spec generation, but the catalog itself is independent.
- **US-GW-01** (API Gateway): The catalog endpoint is served through the gateway with standard authentication and routing.
