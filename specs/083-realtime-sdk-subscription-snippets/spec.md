# Feature Specification: Realtime SDK Subscription Snippets & Examples

**Feature Branch**: `083-realtime-sdk-subscription-snippets`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Implementar ejemplos SDK o snippets para suscripción realtime desde front-end y backend"  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T05  
**Dependencies**: US-DX-01-T01 (channel/subscription model), US-DX-01-T02 (PG→Kafka capture), US-DX-01-T03 (Mongo→Kafka capture), US-DX-01-T04 (auth, scopes & filters)

---

## Objective & Problem Statement

Tasks T01 through T04 have established the entire realtime pipeline: a channel/subscription model, change-data-capture bridges from PostgreSQL and MongoDB into Kafka, and an authorization/scope/filter layer that ensures only permitted events reach each subscriber. **However, none of this is consumable by external developers yet.** There is no documented, copy-paste-ready guidance showing a developer how to:

- Authenticate and open a realtime connection from a browser-based front-end application.
- Subscribe to workspace change events from a Node.js, Python, or other backend service.
- Apply filters to narrow the events they receive.
- Handle token refresh, reconnection, and error scenarios gracefully.

Without SDK snippets and usage examples, the realtime capability remains an internal platform feature rather than a developer-facing product. Developers would need to reverse-engineer the connection protocol, authentication flow, and subscription API from raw OpenAPI specs or source code — creating friction, errors, and support overhead that directly undermine the DX goals of EP-17.

This task specifies the **developer-facing SDK snippets, usage examples, and contextual documentation** that make the realtime subscription pipeline usable by the platform's external consumers. The snippets are served from the administrative console (inline, per workspace) and published in the developer documentation site, enabling developers to integrate realtime subscriptions in minutes rather than hours.

---

## Users & Consumers

| Actor | Value Received |
|-------|---------------|
| **Developer (front-end)** | Gets copy-paste-ready code showing how to open an authenticated WebSocket/SSE connection from a browser, subscribe to workspace events, apply filters, and handle lifecycle events (reconnection, token refresh, errors). |
| **Developer (backend)** | Gets snippets demonstrating server-side subscription to workspace events (e.g., from a Node.js or Python service), including authentication with service-account tokens, durable subscriptions, and event processing patterns. |
| **Workspace Admin** | Can share contextualised snippets with team members during onboarding, reducing time-to-integration and support requests. |
| **Tenant Owner** | Gains confidence that the realtime capability is production-ready and accessible, because developers can self-serve integration without dedicated support. |
| **Integrator** | Gets language-specific examples for embedding realtime event consumption into third-party systems, accelerating partner integrations. |
| **Platform (internal — DevRel / Support)** | Reduces support ticket volume for "how do I subscribe to events?" by providing canonical, maintained examples that stay in sync with the API surface. |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer copies a front-end realtime snippet from the console (Priority: P1)

A developer building a single-page application navigates to the realtime section of their workspace in the administrative console. They see a "Snippets" or "Quick Start" panel showing ready-to-use code for subscribing to realtime events from a browser. The snippet includes the workspace's actual endpoint URL, a placeholder for the developer's authentication token, and a working example of opening a connection and handling incoming events. The developer copies the snippet, pastes it into their application, replaces the token placeholder, and has a working realtime subscription within minutes.

**Why this priority**: The front-end subscription flow is the most visible DX surface — it is the first thing a developer tries when evaluating the platform's realtime capability.

**Independent Test**: Can be tested by navigating to a workspace's realtime section in the console, verifying the snippet panel renders with at least one front-end language (JavaScript/TypeScript), confirming the snippet contains the correct workspace endpoint, and verifying the snippet's code structure is syntactically valid.

**Acceptance Scenarios**:

1. **Given** a developer viewing the realtime section of workspace W in the console, **When** they open the snippets panel, **Then** at least one front-end snippet is displayed (JavaScript/TypeScript) showing how to open an authenticated realtime connection to workspace W.
2. **Given** the displayed snippet, **When** the developer inspects the code, **Then** the snippet contains the workspace's actual realtime endpoint URL (not a generic placeholder), a clearly marked token placeholder (e.g., `<YOUR_ACCESS_TOKEN>`), and working event-handler code for receiving messages.
3. **Given** the displayed snippet, **When** the developer clicks "Copy", **Then** the full snippet is copied to the clipboard and a confirmation is shown.
4. **Given** the snippet is pasted into a browser application and the token placeholder is replaced with a valid token, **When** the application runs, **Then** it establishes a realtime connection and receives events from the workspace (assuming T01–T04 are operational).

---

### User Story 2 — Developer copies a backend realtime snippet from the console (Priority: P1)

A developer building a backend service (e.g., a data pipeline or webhook relay) navigates to the same snippets panel and selects a server-side language (Node.js, Python). The snippet demonstrates authenticated subscription using a service-account token, event processing in a loop/callback, and graceful disconnection.

**Why this priority**: Backend integrations are the second-most common consumption pattern and critical for system-to-system realtime flows.

**Independent Test**: Can be tested by verifying the snippets panel offers at least two backend languages, the snippet uses a service-account token pattern (not browser-session-based), and the code is syntactically valid in the target language.

**Acceptance Scenarios**:

1. **Given** a developer viewing the snippets panel for workspace W, **When** they select a backend language (e.g., Node.js or Python), **Then** a snippet is displayed showing server-side authenticated subscription to workspace W's realtime events.
2. **Given** the backend snippet, **When** the developer inspects the code, **Then** it demonstrates authentication with a service-account or API-key pattern (not an interactive browser login), includes a processing loop or callback for incoming events, and shows graceful disconnection/cleanup.
3. **Given** the snippet is integrated into a backend application with a valid service-account token, **When** the application runs, **Then** it receives workspace events over the realtime channel.

---

### User Story 3 — Snippet includes filter and reconnection examples (Priority: P1)

A developer needs to subscribe to only specific event types (e.g., `INSERT` operations on a particular table) and wants to handle transient disconnections gracefully. The snippet panel provides supplementary examples or annotated sections showing how to:

- Apply event filters at subscription time.
- Handle reconnection when the connection drops.
- Refresh an expired token without losing the subscription.

**Why this priority**: Filters and reconnection are not optional patterns — developers who skip them build fragile integrations that flood with unwanted events or silently break. Including these examples from the start prevents the most common support issues.

**Independent Test**: Can be tested by verifying the snippets panel includes at least one filter example and one reconnection example per language, and that the filter syntax matches the API's supported filter format.

**Acceptance Scenarios**:

1. **Given** a front-end or backend snippet, **When** the developer expands or scrolls to the "Filters" section, **Then** an example is shown demonstrating how to subscribe with a filter (e.g., `operation = INSERT`, `table = orders`), using the exact filter syntax accepted by the subscription API.
2. **Given** a front-end or backend snippet, **When** the developer expands the "Reconnection" section, **Then** an example is shown demonstrating automatic reconnection logic with exponential backoff and optional last-event-ID resumption.
3. **Given** a front-end snippet, **When** the developer expands the "Token Refresh" section, **Then** an example is shown demonstrating how to refresh an expired token on an active connection without full reconnection.

---

### User Story 4 — Snippets are published in the developer documentation site (Priority: P2)

Beyond the in-console snippets, the same examples are available in the platform's developer documentation site, organised by use case (front-end quick start, backend integration, advanced filters, reconnection). The documentation site versions are standalone and include full context (prerequisites, endpoint discovery, authentication setup) so that a developer can follow them without prior access to the console.

**Why this priority**: Documentation-site snippets serve developers who discover the platform through docs rather than the console, and provide a reference that can be linked from support tickets, blog posts, and partner onboarding guides.

**Independent Test**: Can be tested by verifying that the documentation site contains at least one guide per supported language, each guide includes prerequisites, and the code snippets match those served in the console.

**Acceptance Scenarios**:

1. **Given** the developer documentation site, **When** a developer navigates to the "Realtime Quick Start" section, **Then** they find at least one front-end guide (JavaScript/TypeScript) and one backend guide (Node.js or Python) with complete subscription examples.
2. **Given** a documentation guide, **When** the developer reads it end-to-end, **Then** it includes: prerequisites (account, workspace, token), endpoint discovery instructions, the subscription snippet, filter examples, reconnection handling, and common error codes with resolution advice.
3. **Given** the snippets in the documentation site and the snippets in the console, **When** compared side by side, **Then** the code logic and filter syntax are consistent (the console version may be shorter, omitting prerequisites that are obvious in-context).

---

### User Story 5 — Console snippets adapt to workspace context (Priority: P2)

The snippets displayed in the console are not generic templates — they are contextualised with the active workspace's real configuration: the realtime endpoint URL, the workspace identifier, available channel types (based on provisioned data sources), and the developer's current authentication context. If the workspace only has PostgreSQL data sources, the snippet does not show MongoDB channel examples.

**Why this priority**: Context-aware snippets eliminate a major source of copy-paste errors and confusion, but the core value (having any snippet at all) is delivered by P1 stories even with partially generic snippets.

**Independent Test**: Can be tested by viewing snippets in two workspaces with different data-source configurations and verifying the snippets differ in endpoint, workspace ID, and available channel types.

**Acceptance Scenarios**:

1. **Given** workspace W1 with only PostgreSQL data sources, **When** the developer views the snippets panel, **Then** the snippets reference only `postgresql-changes` channels and do not include MongoDB channel examples.
2. **Given** workspace W2 with both PostgreSQL and MongoDB data sources, **When** the developer views the snippets panel, **Then** the snippets reference both `postgresql-changes` and `mongodb-changes` channels.
3. **Given** the developer is authenticated in the console, **When** they view a snippet, **Then** the snippet pre-fills the workspace's realtime endpoint URL and workspace identifier (but still uses a placeholder for the access token, never embedding a real token in the displayed code).

---

### Edge Cases

- **No realtime capability provisioned**: If the workspace has no data sources or realtime is not enabled, the snippets panel displays a clear message explaining that realtime subscriptions require at least one data source and directs the user to provisioning documentation. No broken or misleading snippets are shown.
- **Unsupported language requested**: If the platform does not yet have a snippet for a specific language, the panel shows a generic protocol-level example (e.g., raw WebSocket or cURL for SSE) with a note that a language-specific SDK is forthcoming.
- **Stale endpoint after workspace reconfiguration**: If the workspace's realtime endpoint changes (e.g., due to migration or scaling), the console must serve the updated endpoint in snippets. There is no caching of stale endpoint values in the snippet generation path.
- **Snippet in a language the developer doesn't use**: The panel defaults to the most common language (JavaScript) but allows switching. The selected language preference persists within the session.
- **Large number of channel types**: If the workspace supports many channel types, the snippet panel shows examples for the most common types (PostgreSQL, MongoDB) and provides a "See all channels" link rather than rendering an overwhelming number of snippets.
- **Accessibility**: Snippet code blocks must be keyboard-navigable, screen-reader-friendly (with appropriate ARIA labels), and support high-contrast themes.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The console MUST display a snippets panel in the realtime section of each workspace, showing at least one front-end (JavaScript/TypeScript) and one backend (Node.js or Python) subscription example.
- **FR-002**: Each snippet MUST contain the workspace's actual realtime endpoint URL and workspace identifier, populated from the active workspace context.
- **FR-003**: Each snippet MUST use a clearly marked placeholder for the authentication token (e.g., `<YOUR_ACCESS_TOKEN>`) and MUST NOT embed real tokens or secrets.
- **FR-004**: Each snippet MUST include working event-handler code that demonstrates receiving and processing at least one event.
- **FR-005**: The snippets panel MUST include at least one example per supported language showing how to apply an event filter at subscription time, using the exact filter syntax accepted by the subscription API.
- **FR-006**: The snippets panel MUST include at least one example per supported language showing reconnection logic with backoff and optional event-ID-based resumption.
- **FR-007**: The snippets panel MUST include at least one front-end example showing token-refresh handling on an active connection.
- **FR-008**: Each snippet MUST be copyable to the clipboard via a single-click "Copy" action, with visual confirmation of the copy operation.
- **FR-009**: The console MUST adapt displayed snippets to the workspace's provisioned data sources — only channel types corresponding to active data sources are shown in examples.
- **FR-010**: The console MUST display a clear informational message (not broken snippets) when the workspace has no provisioned data sources or realtime is not enabled.
- **FR-011**: The developer documentation site MUST publish at least one complete realtime quick-start guide per supported language, including prerequisites, endpoint discovery, authentication, subscription, filters, reconnection, and common errors.
- **FR-012**: The documentation-site snippets MUST be consistent with the console snippets in code logic and filter syntax.
- **FR-013**: Backend snippets MUST demonstrate a service-account or API-key authentication pattern, distinct from the interactive browser-session pattern used in front-end snippets.
- **FR-014**: The snippets panel MUST default to JavaScript and allow the developer to switch languages; the selected language MUST persist within the console session.
- **FR-015**: Snippet code blocks in the console MUST be keyboard-navigable and include appropriate ARIA attributes for screen-reader accessibility.

### Key Entities

- **Snippet Template**: A parameterised code template for a specific language and use case (front-end subscription, backend subscription, filter example, reconnection example). Accepts workspace context (endpoint URL, workspace ID, available channel types) as input parameters.
- **Workspace Realtime Context**: The set of runtime values needed to contextualise a snippet: realtime endpoint URL, workspace identifier, tenant identifier, list of available channel types (derived from provisioned data sources), and supported filter syntax version.
- **Documentation Guide**: A standalone, versioned document published on the developer documentation site, containing one or more snippets with full surrounding context (prerequisites, setup, troubleshooting).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The console snippets panel renders in under 2 seconds for any workspace with realtime capability enabled.
- **SC-002**: At least 3 languages/runtimes are covered by snippets at launch: JavaScript (browser), Node.js (backend), Python (backend).
- **SC-003**: Every snippet displayed in the console is syntactically valid in its target language — validated by automated linting as part of the release process.
- **SC-004**: The developer documentation site contains at least one complete quick-start guide per supported language, reachable within 2 clicks from the documentation home page.
- **SC-005**: Snippet content reflects the current workspace context: the endpoint URL and workspace ID match the active workspace, and channel types match provisioned data sources, with zero stale values served.
- **SC-006**: The "Copy" action works in all supported browsers (latest versions of Chrome, Firefox, Safari, Edge) and provides visual feedback within 500 ms.
- **SC-007**: In user testing (or review), a developer unfamiliar with the platform can establish a working realtime subscription using only the console snippet and token within 10 minutes.

---

## Permissions, Multi-Tenant Isolation, Auditing, Quotas & Security

### Permissions

- Viewing snippets in the console requires at minimum read access to the workspace's realtime configuration (the same permission level needed to view the realtime section).
- Snippets never reveal secrets, tokens, passwords, or credentials. All sensitive values are replaced by descriptive placeholders with a reference to where the real value can be obtained.
- The documentation-site guides are publicly accessible (no authentication required) and never contain workspace-specific secrets.

### Multi-Tenant Isolation

- The console snippet generation path receives workspace context exclusively from the authenticated session's tenant and workspace scope. It is impossible for snippets to leak another tenant's endpoint URL or workspace identifier.
- Snippet templates are tenant-agnostic; only the runtime parameters are tenant/workspace-specific.

### Auditing

- No new audit events are required specifically for snippet viewing or copying — these are read-only, non-sensitive actions.
- If analytics tracking is implemented for snippet usage (e.g., "which snippets are copied most often"), it must be anonymised and must not capture token values or workspace-identifying data in analytics pipelines.

### Quotas

- No quotas apply to snippet viewing or copying — these are passive read operations with negligible resource impact.

### Security

- Snippets MUST NOT include real tokens, API keys, or secrets. The placeholder pattern (e.g., `<YOUR_ACCESS_TOKEN>`) is mandatory.
- Snippet templates are code artifacts that MUST be reviewed for injection risks — a template must not allow workspace-name values or user-supplied data to break out of string literals or introduce executable code when rendered.
- The documentation site guides MUST NOT include example credentials that could be mistaken for real ones (e.g., avoid using plausible-looking JWT strings).

---

## Scope Boundaries

### In Scope

- Console-embedded snippets for front-end and backend realtime subscription.
- Filter, reconnection, and token-refresh examples within snippets.
- Workspace-contextualised snippet rendering (endpoint URL, workspace ID, available channel types).
- Developer documentation site guides for realtime quick start, with full prerequisites and troubleshooting.
- Clipboard copy functionality for console snippets.
- Accessibility requirements for snippet code blocks.
- Syntax validity validation of snippet templates.

### Out of Scope

- **US-DX-01-T01**: Channel/subscription model design (assumed available).
- **US-DX-01-T02**: PostgreSQL CDC pipeline (assumed operational).
- **US-DX-01-T03**: MongoDB change-stream pipeline (assumed operational).
- **US-DX-01-T04**: Authentication, scopes, and filter enforcement (assumed operational).
- **US-DX-01-T06**: End-to-end tests for subscription, reconnection, and tenant isolation.
- Full SDK library design, packaging, and distribution (e.g., publishing an npm/pip package). This task covers **snippets and examples**, not a maintained SDK library.
- Interactive playground or sandbox environment for trying snippets live.
- Video tutorials or interactive walkthroughs.
- Localisation/internationalisation of snippet descriptions (English only in initial release).

---

## Assumptions

- The realtime subscription API surface from T01 is stable and documented (at minimum in OpenAPI or equivalent contract), providing the endpoint URL pattern, authentication header format, subscription creation parameters, filter syntax, and event payload schema.
- The authentication flow from T04 is operational, so that snippets demonstrating token-based auth produce working results when a valid token is supplied.
- The console already has a workspace-detail view with a realtime section (or an appropriate location where the snippets panel can be added).
- The developer documentation site infrastructure exists and supports publishing new guides (the content management pipeline is not in scope for this task).
- The existing console snippet infrastructure from US-UI-04-T05 (065-connection-snippets) provides a reusable UI pattern (snippet panel, language selector, copy-to-clipboard) that can be extended for realtime snippets.

---

## Risks & Open Questions

| # | Type | Description | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | Risk | The realtime API surface from T01–T04 may still be evolving when snippet authoring begins, leading to snippets that become outdated before release. | Snippets show incorrect API calls or parameters. | Snippets should be authored from the published API contract (OpenAPI/AsyncAPI), not from implementation details. Snippets must be validated against the contract as part of CI. |
| R2 | Risk | Contextualised snippet rendering depends on accurate workspace metadata (endpoint URL, provisioned data sources). If the metadata API is incomplete, snippets may show generic placeholders instead of real values. | Reduced DX value — developers still have to discover endpoints manually. | Define the minimum metadata contract required by snippet templates and validate it is available before this task begins implementation. |
| R3 | Risk | Snippet maintenance burden — as the realtime API evolves, snippets must be updated across console and documentation site. | Drift between API and examples causes developer confusion. | Store snippet templates as versioned artifacts co-located with the API contract; automate staleness detection. |
| OQ1 | Open Question | Should the initial release support only WebSocket-based snippets, or also SSE (Server-Sent Events) snippets? | Determines the number of snippet variants per language. | Recommend starting with the transport protocol chosen as primary in T01 architecture; add the secondary transport as a fast follow-up. |
| OQ2 | Open Question | Is there an existing snippet rendering component from 065-connection-snippets that can be reused, or does realtime require a new component? | Affects implementation effort and consistency. | Verify reusability during planning phase; if reusable, extend; if not, design a shared component that both 065 and 083 can use. |
