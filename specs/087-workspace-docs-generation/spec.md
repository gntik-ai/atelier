# Feature Specification: Per-Workspace Developer Documentation Generation

**Feature Branch**: `087-workspace-docs-generation`  
**Created**: 2026-03-30  
**Status**: Draft  
**Task ID**: US-DX-02-T03  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades  
**Input**: Generar documentación por workspace con base URL, credenciales, endpoints habilitados y ejemplos.

## Problem Statement

Developers integrating with a BaaS multi-tenant platform need clear, actionable documentation that reflects the specific configuration of the workspace they are working with — not generic API docs that require them to mentally substitute URLs, credentials, scopes, and available services. Today, developers face several friction points:

- **Unknown base URL and service endpoints**: Each workspace may have a unique base URL, and the set of enabled services (PostgreSQL, MongoDB, storage, functions, realtime, etc.) varies by tenant plan and workspace configuration. Developers must manually discover which endpoints exist and how to reach them.
- **Credential and authentication ambiguity**: Developers must locate API keys, client IDs, and authentication flows across multiple console screens, then manually compose authorization headers. Mistakes lead to failed integrations and support tickets.
- **Incomplete capability awareness**: A workspace may have certain capabilities disabled (e.g., realtime not provisioned, storage not enabled). Without a centralized, contextualised documentation page, developers waste time attempting to use features that are unavailable in their workspace.
- **No ready-to-use examples**: Even when endpoints are known, developers lack copy-paste code examples pre-filled with their workspace's real values (URLs, ports, resource names), forcing them to adapt generic samples and increasing error rates.

This feature specifies a **per-workspace documentation page** (accessible from the console and optionally via API) that dynamically generates and presents an integration guide containing the workspace's base URL, authentication details, the list of enabled endpoints/services, and contextualised code examples — all derived from the workspace's actual live configuration.

## User Scenarios & Testing

### User Story 1 — View Workspace Documentation Page (Priority: P1)

A developer who has access to a workspace opens the console and navigates to a "Documentation" or "Getting Started" section within that workspace. The page displays a structured integration guide that includes: the workspace's base URL, authentication instructions (how to obtain and use API keys or tokens), and a summary of all enabled services/endpoints grouped by category (data, storage, functions, realtime, webhooks, etc.). The content reflects the current live configuration of the workspace — disabled services are not shown, and all URLs and identifiers are pre-filled with actual values.

**Why this priority**: This is the foundational view that all other documentation scenarios depend on. Without a documentation page, no other documentation capability delivers value.

**Independent Test**: Can be verified by navigating to the documentation section of a workspace with known enabled services and confirming that the displayed base URL, enabled endpoints, and authentication instructions match the workspace's actual configuration.

**Acceptance Scenarios**:

1. **Given** a developer with read access to a workspace that has PostgreSQL, storage, and functions enabled, **When** they navigate to the workspace documentation page, **Then** the page displays the workspace base URL, authentication instructions, and sections for PostgreSQL, storage, and functions endpoints — but not for services that are disabled (e.g., realtime, webhooks).
2. **Given** a workspace where a service is enabled after initial setup (e.g., realtime is activated), **When** the developer refreshes the documentation page, **Then** the newly enabled service appears in the documentation with its correct endpoint and instructions.
3. **Given** a developer without access to the workspace, **When** they attempt to view the documentation page, **Then** access is denied with an appropriate authorization error.
4. **Given** a workspace with no services currently enabled, **When** the developer opens the documentation page, **Then** the page displays the base URL and authentication instructions, plus a clear message indicating that no services are currently enabled, with guidance on how to enable them.

---

### User Story 2 — Copy Pre-Filled Code Examples (Priority: P1)

For each enabled service listed on the documentation page, the developer can expand or navigate to contextualised code examples. Each example is a working code snippet (e.g., connecting to the workspace's PostgreSQL database, uploading a file to the workspace's storage bucket, invoking a function) with real workspace values pre-filled: host, port, database name, bucket name, function URL, etc. Sensitive credentials (passwords, API secrets) are replaced with descriptive placeholders and a reference to where the actual value can be obtained in the console. Each example has a "Copy" action for quick clipboard transfer.

**Why this priority**: Code examples are the primary accelerator for developer onboarding. Without pre-filled examples, the documentation page is informational but not actionable.

**Independent Test**: Can be verified by viewing examples for an enabled service, confirming that workspace-specific values (base URL, resource names) are correctly substituted, that sensitive values show placeholders, and that the copy action places the full snippet on the clipboard.

**Acceptance Scenarios**:

1. **Given** a workspace with a PostgreSQL database named "app_db" on a specific host, **When** the developer views the PostgreSQL code examples, **Then** the snippets contain the actual host, port, and database name for that workspace, with the password replaced by a placeholder like `<YOUR_DB_PASSWORD>`.
2. **Given** any code example on the documentation page, **When** the developer clicks "Copy", **Then** the full code block is copied to the clipboard and a transient visual confirmation is shown.
3. **Given** a service that supports multiple languages/SDKs (e.g., PostgreSQL: Node.js, Python, Go), **When** the developer views examples for that service, **Then** multiple language/tool tabs or sections are available, each with a correctly contextualised snippet.
4. **Given** a workspace where a resource has been renamed or reconfigured, **When** the developer views the documentation page, **Then** the examples reflect the current names and configuration, not stale values.

---

### User Story 3 — Retrieve Documentation via API (Priority: P2)

An integrator or CI/CD pipeline can retrieve the workspace documentation content programmatically via an API endpoint. The response includes the same structured information as the console page: base URL, authentication details, enabled services with their endpoints, and code examples. This allows automated tooling to consume workspace configuration data for codegen, environment setup, or developer portal syndication.

**Why this priority**: API access enables automation and extends documentation value beyond the console, but the primary consumption channel (console UI) must work first.

**Independent Test**: Can be verified by calling the documentation API endpoint with valid workspace credentials and confirming the response structure matches expected schema, contains correct workspace-specific values, and respects the same permission model as the console.

**Acceptance Scenarios**:

1. **Given** a developer with API access to a workspace, **When** they call the workspace documentation endpoint, **Then** the response contains structured data including base URL, authentication instructions, enabled services with endpoints, and code examples — matching the console page content.
2. **Given** a developer without workspace access, **When** they call the documentation endpoint, **Then** the system returns an authorization error.
3. **Given** a workspace with specific enabled services, **When** the API response is returned, **Then** only enabled services are included, and the response format is consistent and parseable (structured data, not raw HTML).

---

### User Story 4 — Workspace Admin Customises Documentation Notes (Priority: P3)

A workspace admin can add custom notes or instructions to the documentation page (e.g., internal team guidelines, environment-specific instructions, links to internal wikis). These custom notes appear alongside the auto-generated documentation and are persisted per workspace. This allows teams to augment the platform-generated docs with organisation-specific context.

**Why this priority**: Custom notes add value for teams with specific onboarding procedures, but the core auto-generated documentation delivers the majority of the value independently.

**Independent Test**: Can be verified by a workspace admin adding a custom note, then a developer viewing the documentation page and seeing both the auto-generated content and the custom note.

**Acceptance Scenarios**:

1. **Given** a workspace admin, **When** they add a custom note to the documentation page, **Then** the note is persisted and visible to all workspace members on subsequent visits.
2. **Given** a workspace admin, **When** they edit or remove an existing custom note, **Then** the change is reflected immediately on the documentation page.
3. **Given** a developer (non-admin) viewing the documentation page, **When** custom notes exist, **Then** they are displayed but the developer cannot edit or delete them.
4. **Given** a custom note containing potentially unsafe content (scripts, HTML injection), **When** it is saved and rendered, **Then** the content is sanitised and displayed safely.

---

### Edge Cases

- What happens when a workspace's base URL changes (e.g., due to domain reconfiguration)? The documentation page must reflect the new URL immediately without requiring manual updates.
- What happens when a service endpoint is temporarily unavailable but still enabled? The documentation should still show the endpoint (it is configured), optionally with a status indicator if health information is available.
- What happens when the documentation page is accessed by a user with read-only permissions on some workspace resources? The page shows all enabled services but the user sees only the endpoints and examples for resources they have permission to access; restricted resources display a "restricted access" notice.
- What happens when the workspace has dozens of enabled services? The documentation page must remain navigable with clear categorisation and a table of contents or anchor links.
- What happens when a code example template references a capability that has been deprecated or removed? The system should gracefully omit the example rather than display broken or misleading content.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide a documentation page within the console for each workspace that is dynamically generated from the workspace's current configuration.
- **FR-002**: The documentation page MUST display the workspace's base URL as its primary reference point for all API interactions.
- **FR-003**: The documentation page MUST include authentication instructions explaining how to obtain and use credentials (API keys, OAuth tokens) for the workspace, without exposing actual secrets in plaintext.
- **FR-004**: The documentation page MUST list all currently enabled services/endpoints for the workspace, grouped by category (data services, storage, functions, realtime, webhooks, scheduling, etc.), and MUST NOT display disabled services.
- **FR-005**: For each enabled service, the documentation page MUST provide at least one contextualised code example with workspace-specific values (URLs, resource names, ports) pre-filled.
- **FR-006**: Sensitive credential values in code examples MUST be replaced with descriptive placeholders (e.g., `<YOUR_API_KEY>`) accompanied by a textual reference to where the actual value can be found in the console.
- **FR-007**: Each code example MUST have a "Copy to clipboard" action that copies the complete code block and provides transient visual feedback confirming the copy.
- **FR-008**: The documentation content MUST update automatically when the workspace's configuration changes (services enabled/disabled, resources renamed, base URL changed) without requiring manual regeneration.
- **FR-009**: The system MUST provide an API endpoint that returns the workspace documentation content in a structured, parseable format (not raw HTML), respecting the same authorization model as the console.
- **FR-010**: The documentation page MUST respect multi-tenant isolation: a user can only view documentation for workspaces they have been granted access to.
- **FR-011**: Workspace admins MUST be able to add, edit, and remove custom notes that are displayed alongside the auto-generated documentation.
- **FR-012**: Custom notes MUST be sanitised to prevent injection attacks (XSS, HTML injection) before storage and rendering.
- **FR-013**: The system MUST record an audit event when documentation is accessed (at a reasonable granularity — e.g., per-session or per-day, not per-page-render) to support usage analytics and compliance.
- **FR-014**: The documentation page MUST support workspace-level access control: users with read access to the workspace can view the documentation; users without access are denied.
- **FR-015**: When a user has restricted permissions on certain workspace resources, the documentation page MUST either show only the resources the user can access, or show all enabled resources with a "restricted access" indicator on those the user cannot use.

### Key Entities

- **Workspace Documentation**: A dynamically generated view representing the integration guide for a specific workspace. Contains base URL, authentication instructions, enabled service catalogue, and code examples. Not a pre-generated static document — derived at request time from workspace state.
- **Documentation Custom Note**: A user-authored text block associated with a workspace's documentation page. Created and managed by workspace admins. Persisted per workspace with authorship and timestamp metadata.
- **Service Endpoint Entry**: A logical representation of an enabled service within the workspace (e.g., PostgreSQL database, storage bucket, functions runtime). Includes the service type, endpoint URL, port, and resource identifiers needed to construct examples.
- **Code Example Template**: A parameterised snippet template for a specific service type and language/tool combination. Contains placeholders for workspace-specific values that are substituted at render time.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A developer new to a workspace can copy a working code example and successfully connect to an enabled service within 5 minutes of opening the documentation page, without consulting external documentation.
- **SC-002**: The documentation page accurately reflects 100% of the workspace's currently enabled services — no stale, missing, or phantom entries.
- **SC-003**: Configuration changes to the workspace (enabling/disabling a service, renaming a resource, changing the base URL) are reflected on the documentation page within 30 seconds of the change being committed.
- **SC-004**: At least 3 language/tool example variants are available for each core service type (data, storage, functions).
- **SC-005**: 90% of developers integrating a workspace for the first time rate the documentation page as sufficient to begin integration without additional support.
- **SC-006**: Support tickets related to "how to connect to workspace services" or "what is my workspace URL" decrease by at least 40% within 3 months of launch.

## Assumptions

- The workspace configuration (enabled services, endpoints, resource names) is already tracked and queryable via existing internal APIs or data models established by prior features (connection snippets — spec 065, capability catalogue — US-DX-02-T06).
- Authentication mechanisms (API keys, OAuth flows) are already implemented and documented at the platform level; this feature surfaces workspace-specific instances of those mechanisms, not the mechanisms themselves.
- Code example templates will initially cover the most common languages/tools for each service type; additional language coverage can be added incrementally without changing the feature's core behaviour.
- The console already has a workspace-level navigation structure where a "Documentation" section or tab can be added.
- Custom notes are stored as plain text or sanitised markdown; rich media embedding (images, videos) is out of scope for the initial delivery.

## Dependencies

- **US-DX-02-T01** (Outbound Webhooks): Webhook service endpoints must be queryable so the documentation page can include webhook-related endpoints when enabled.
- **US-DX-02-T02** (Scheduling/Automation): Scheduling service endpoints must be queryable for inclusion in documentation when enabled.
- **US-UI-04-T05** (Connection Snippets — spec 065): The code example patterns and placeholder conventions established by connection snippets should be reused and extended by this feature to ensure consistency.
- **US-GW-01** (API Gateway): Base URL resolution depends on the gateway configuration for the workspace.

## Out of Scope

- Generating downloadable SDK packages (covered by US-DX-02-T04).
- API key rotation workflows (covered by US-DX-02-T05).
- Full capability catalogue with interactive exploration (covered by US-DX-02-T06).
- Versioned documentation (tracking historical documentation states across workspace configuration changes).
- Internationalisation / multi-language documentation prose (examples are multi-language by code language, not by human language).
