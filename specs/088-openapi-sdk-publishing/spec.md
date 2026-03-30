# Feature Specification: OpenAPI Publishing & SDK Generation

**Feature Branch**: `088-openapi-sdk-publishing`  
**Created**: 2026-03-30  
**Status**: Draft  
**Task ID**: US-DX-02-T04  
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador  
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades  
**Input**: Publicar OpenAPI y, donde sea viable, generar SDKs para lenguajes principales.

## Problem Statement

Developers integrating with a multi-tenant BaaS platform need a machine-readable, standards-based contract that describes the exact API surface available in their workspace. Currently:

- **No single source of truth for the API contract**: Developers must piece together endpoint behaviour from scattered documentation, console screens, and trial-and-error calls. There is no downloadable, version-controlled OpenAPI specification they can feed into their toolchains.
- **Workspace-specific API surfaces are invisible to tooling**: Because each workspace may have different capabilities enabled (storage, functions, realtime, MongoDB, etc.), a generic, platform-wide OpenAPI document would advertise endpoints the developer cannot actually use — leading to confusion and wasted integration effort.
- **No SDK artefacts for popular languages**: Developers writing integrations in JavaScript/TypeScript, Python, Go, or other mainstream languages must hand-craft HTTP calls, authentication headers, and error-handling boilerplate. This increases time-to-first-call, raises the error rate, and discourages adoption.
- **Integration tooling cannot be leveraged**: Without an OpenAPI spec, developers cannot auto-generate typed clients, Postman collections, mock servers, or contract tests — all of which dramatically reduce integration friction in modern development workflows.

This feature specifies the ability for the platform to **publish a workspace-scoped OpenAPI specification** that accurately reflects the workspace's enabled capabilities and API surface, and to **offer pre-generated SDK packages** (where viable) for the most commonly used programming languages — enabling developers to integrate with minimal friction using industry-standard tooling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Download the Workspace OpenAPI Specification (Priority: P1)

A workspace developer wants to understand the full API contract available in their workspace. They navigate to the developer documentation section of the console (or call a well-known API endpoint) and download an OpenAPI 3.x specification document in JSON or YAML format. The document reflects only the capabilities currently enabled in the workspace (e.g., if storage is not provisioned, storage endpoints are absent). The developer can then import this document into tools like Postman, Insomnia, Swagger UI, or their own code-generation pipeline.

**Why this priority**: The OpenAPI spec is the foundational artefact from which all other developer experience features (SDKs, Postman collections, contract tests) are derived. Without it, nothing else works.

**Independent Test**: Can be verified by enabling a known set of capabilities in a workspace, requesting the OpenAPI document, and confirming it contains exactly the expected paths, operations, and schemas — and omits disabled capabilities.

**Acceptance Scenarios**:

1. **Given** a workspace with storage, functions, and authentication capabilities enabled, **When** a developer requests the OpenAPI specification via the console download button or the dedicated API endpoint, **Then** the returned document is a valid OpenAPI 3.x specification containing paths and operations only for storage, functions, and authentication — and no paths for disabled capabilities like realtime or MongoDB.
2. **Given** a workspace developer, **When** they request the OpenAPI specification, **Then** the document includes the workspace's actual base URL, authentication schemes, and server entries so it can be used directly without manual edits.
3. **Given** a workspace developer, **When** they request the specification in JSON format, **Then** they receive a valid JSON document with the correct content type; **When** they request YAML, **Then** they receive valid YAML with the correct content type.
4. **Given** a workspace where a capability is subsequently enabled or disabled by the tenant owner, **When** the developer re-downloads the OpenAPI specification, **Then** the document reflects the updated set of enabled capabilities.
5. **Given** an unauthenticated request to the OpenAPI specification endpoint, **When** the workspace requires authentication for spec access, **Then** the request is rejected with an appropriate authentication error.

---

### User Story 2 — Browse the Interactive API Reference (Priority: P1)

A workspace developer wants to explore the API interactively without leaving the console. The console renders the workspace's OpenAPI specification as a browsable, searchable API reference with endpoint descriptions, request/response schemas, parameter documentation, and example payloads. The developer can try out endpoints directly from this reference using their workspace credentials.

**Why this priority**: An interactive reference is the primary way most developers discover and understand an API; it complements the downloadable spec and is critical for reducing time-to-first-successful-call.

**Independent Test**: Can be verified by navigating to the API reference page in the console, confirming the rendered documentation matches the workspace's enabled capabilities, and successfully executing a sample request against a live endpoint.

**Acceptance Scenarios**:

1. **Given** a workspace developer viewing the console, **When** they navigate to the API reference section, **Then** they see a browsable, searchable rendering of the workspace's OpenAPI specification grouped by capability/tag.
2. **Given** the interactive API reference, **When** a developer expands an endpoint, **Then** they see the HTTP method, path, description, parameters, request body schema, response schemas (including error responses), and at least one example per operation.
3. **Given** a developer viewing an endpoint in the reference, **When** they use the "Try it" functionality, **Then** the request is sent to the workspace's actual API with the developer's current authentication context, and the real response is displayed.
4. **Given** a workspace with a reduced set of capabilities, **When** the developer views the API reference, **Then** only endpoints for enabled capabilities appear — disabled capabilities are not shown (not greyed out, not marked unavailable — entirely absent).

---

### User Story 3 — Download a Pre-Generated SDK for a Supported Language (Priority: P2)

A workspace developer working in JavaScript/TypeScript or Python (the two initially supported languages) wants a typed client library that wraps the workspace's API. From the console or the documentation API, they select their language and download or install a pre-generated SDK package. The SDK includes typed methods for every enabled endpoint, built-in authentication handling, and inline documentation derived from the OpenAPI spec.

**Why this priority**: SDKs dramatically reduce integration time and error rates, but they depend on the OpenAPI spec being correct and complete (US1). Supporting the two most popular languages first maximises coverage with minimum effort.

**Independent Test**: Can be verified by downloading the SDK for a supported language, importing it into a minimal project, and successfully making an authenticated API call using the SDK's typed methods.

**Acceptance Scenarios**:

1. **Given** a workspace developer on the SDK download page, **When** they select "JavaScript/TypeScript" or "Python", **Then** they receive a downloadable package (or installation instructions pointing to a workspace-scoped package registry endpoint) that contains a typed client for every enabled capability in their workspace.
2. **Given** a downloaded SDK, **When** the developer initialises the client with their workspace URL and API key, **Then** the client successfully authenticates and can perform operations on enabled endpoints without manually constructing HTTP requests.
3. **Given** a workspace where a capability has been disabled since the last SDK generation, **When** the developer downloads a fresh SDK, **Then** the new SDK no longer includes methods for the disabled capability.
4. **Given** a developer requesting an SDK for an unsupported language, **When** they view the SDK download page, **Then** they see a clear message indicating which languages are currently supported, and are offered the OpenAPI spec as a fallback for code generation with third-party tools.
5. **Given** a generated SDK, **When** the developer inspects the package, **Then** each public method includes inline documentation (JSDoc/docstrings) derived from the OpenAPI operation descriptions.

---

### User Story 4 — Receive Notification of API Changes (Priority: P3)

A workspace developer who has previously downloaded the OpenAPI spec or an SDK wants to know when the API contract changes (e.g., a new capability is enabled, an endpoint is added, or a breaking change is introduced). The platform provides a versioning scheme for the OpenAPI spec and a mechanism (console notification, event, or webhook) to alert subscribed developers when a new version is available.

**Why this priority**: Change notification prevents integration breakage and enables proactive SDK updates, but it requires the spec publishing pipeline (US1) and ideally webhooks (US-DX-02-T01) to be in place first.

**Independent Test**: Can be verified by changing a workspace's enabled capabilities, confirming the spec version increments, and verifying that a subscribed developer receives a notification or can detect the version change.

**Acceptance Scenarios**:

1. **Given** a published OpenAPI specification for a workspace, **When** the workspace's enabled capabilities change (capability added or removed), **Then** the specification version is incremented and the new version is immediately available at the same endpoint.
2. **Given** a workspace developer who has opted into API change notifications, **When** the OpenAPI specification version changes, **Then** the developer receives a notification (via the console notification centre and, if webhooks are configured, via a webhook delivery with event type `api_spec.updated`).
3. **Given** a developer requesting the OpenAPI specification, **When** they include a version or ETag-based conditional header, **Then** the system responds with `304 Not Modified` if the spec has not changed, avoiding unnecessary downloads.

---

### Edge Cases

- **Workspace with zero capabilities enabled**: The OpenAPI specification should still be valid and downloadable, containing only the authentication and common error schemas but no operational paths. SDKs for such a workspace should generate a valid but empty client.
- **Concurrent capability changes during spec generation**: If a capability is enabled or disabled while the spec is being generated, the resulting document must be internally consistent (reflecting either the state before or after the change, not a mix).
- **Very large API surfaces**: Workspaces with all capabilities enabled may produce large OpenAPI documents. The system should handle specs up to the maximum possible surface without timeout or truncation.
- **SDK generation failure**: If the SDK generation pipeline fails for a specific workspace configuration, the system should surface a clear error message and still offer the raw OpenAPI spec as a fallback.
- **Rate limiting on spec/SDK endpoints**: Frequent polling of the spec or SDK download endpoints by automated tools should be handled gracefully with appropriate caching headers and rate limit responses.
- **Tenant-level vs workspace-level scoping**: The OpenAPI spec and SDKs are scoped to a workspace. Different workspaces under the same tenant may have different specs if their enabled capabilities differ.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate a valid OpenAPI 3.x specification document for each workspace that accurately reflects the workspace's currently enabled capabilities, base URL, authentication schemes, and server configuration.
- **FR-002**: The system MUST serve the workspace OpenAPI specification via a dedicated, authenticated API endpoint in both JSON and YAML formats, selectable via content negotiation or query parameter.
- **FR-003**: The system MUST provide a download action for the OpenAPI specification from the workspace's developer documentation section in the console.
- **FR-004**: The system MUST render the workspace's OpenAPI specification as an interactive, browsable, and searchable API reference within the console, including endpoint descriptions, parameter documentation, request/response schemas, examples, and a "Try it" capability.
- **FR-005**: The system MUST dynamically include or exclude API paths and schemas based on the capabilities currently enabled in the workspace — disabled capabilities MUST NOT appear in the spec or the interactive reference.
- **FR-006**: The system MUST version each workspace's OpenAPI specification, incrementing the version when the workspace's API surface changes (capability enabled/disabled, schema change).
- **FR-007**: The system MUST support conditional requests (ETag or Last-Modified) on the specification endpoint to allow efficient polling and caching.
- **FR-008**: The system MUST generate downloadable SDK packages for at least JavaScript/TypeScript and Python, scoped to the workspace's enabled capabilities.
- **FR-009**: Generated SDKs MUST include typed methods for all operations in the workspace's OpenAPI spec, built-in authentication handling, and inline documentation derived from the spec.
- **FR-010**: The system MUST provide SDK download or installation instructions from the console's developer documentation section, clearly listing supported languages and offering the raw OpenAPI spec as a fallback for unsupported languages.
- **FR-011**: The system MUST regenerate the OpenAPI spec and invalidate cached SDKs when a workspace's enabled capabilities change.
- **FR-012**: The system MUST enforce workspace-level access control on the OpenAPI spec and SDK download endpoints — only authenticated members of the workspace (or roles with appropriate permissions) may access them.
- **FR-013**: The system MUST log access to the OpenAPI specification and SDK download endpoints in the workspace's audit trail, including the identity of the requester and the spec version accessed.
- **FR-014**: The system MUST respect tenant and workspace quotas for API call rate limiting on the spec and SDK endpoints.
- **FR-015**: The system MUST surface a clear, user-friendly error when SDK generation fails for a particular workspace configuration, and still allow the developer to download the raw OpenAPI spec.
- **FR-016**: The system MUST notify workspace developers (via the console notification centre) when the OpenAPI specification version changes. If webhooks are configured (US-DX-02-T01), the system SHOULD also emit an `api_spec.updated` event.

### Key Entities

- **OpenAPI Specification**: A versioned, workspace-scoped document conforming to the OpenAPI 3.x standard. Key attributes: workspace ID, version identifier, format (JSON/YAML), content hash (for ETag), generation timestamp, set of included capability tags.
- **SDK Package**: A generated, workspace-scoped code package for a specific programming language. Key attributes: workspace ID, target language, SDK version (derived from spec version), generation status (pending/ready/failed), download URL or registry coordinates, generation timestamp.
- **Capability Manifest**: The set of capabilities currently enabled in a workspace (e.g., storage, functions, realtime, authentication, MongoDB, PostgreSQL). This is an existing concept consumed by the spec generator to determine which paths/schemas to include.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace developer can download a valid, workspace-specific OpenAPI specification within 5 seconds of requesting it.
- **SC-002**: The downloaded OpenAPI specification passes validation with standard OpenAPI linting tools without errors.
- **SC-003**: 90% of developers can make their first successful API call using only the interactive API reference within 10 minutes of accessing it.
- **SC-004**: A workspace developer can download and use a generated SDK to make an authenticated API call in under 15 minutes from first visit.
- **SC-005**: When a workspace's capabilities change, the OpenAPI specification reflects the new state within 2 minutes.
- **SC-006**: The interactive API reference correctly shows zero endpoints for disabled capabilities across all workspace configurations tested.
- **SC-007**: All spec and SDK download requests are recorded in the workspace audit trail with no gaps.

## Assumptions

- The platform already maintains a reliable, queryable capability manifest per workspace that indicates which services are enabled (consumed by the per-workspace documentation feature US-DX-02-T03).
- The interactive API reference renderer will be embedded in the existing console infrastructure (React + Tailwind + shadcn/ui), leveraging an open-source OpenAPI rendering component.
- SDK generation for JavaScript/TypeScript and Python is viable using the OpenAPI specification as input. Additional languages (Go, Java, C#) may be added in future iterations based on developer demand.
- The webhook event `api_spec.updated` depends on the outbound webhooks subsystem (US-DX-02-T01) being available; if not yet deployed, only console notifications are emitted.
- The OpenAPI spec endpoint and SDK downloads are workspace-scoped and subject to the same RBAC and multi-tenant isolation rules as all other workspace resources.

## Dependencies

- **US-DX-02-T03** (Per-workspace documentation generation): Provides the workspace capability manifest and documentation infrastructure that the OpenAPI spec generator builds upon.
- **US-DX-02-T01** (Outbound webhooks): Optional dependency for emitting `api_spec.updated` webhook events; the feature operates without it (console notifications only).
- **US-DX-02-T06** (Capability catalogue): The capability catalogue enumerates available capabilities; the OpenAPI generator uses the same source of truth to determine which paths to include.
