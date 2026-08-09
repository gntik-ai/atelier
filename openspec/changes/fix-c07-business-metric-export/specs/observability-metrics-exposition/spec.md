## ADDED Requirements

### Requirement: MCP tool-invocation and latency families on the metrics plane

The system SHALL export, at the existing executor `/metrics` scrape endpoint, the two business/component families that real MCP tool invocations produce — `in_falcone_mcp_tool_invocations_total` (counter) and `in_falcone_component_operation_duration_seconds` (histogram, `subsystem="mcp"`, `operation="tool_call"`) — rendered as valid Prometheus text exposition, so that P1/P3/P4/P7/P9/P10/P12 observability consumers can see MCP tool usage and tool latency. Each family SHALL be backed only by actual completed MCP tool invocations and SHALL carry the required contract labels (`environment`, `subsystem`, `metric_scope`, `collection_mode`, and the family-specific dimensions).

#### Scenario: Successful tool call is recorded

- **WHEN** an authorized MCP `call_tool` (or JSON-RPC `tools/call`) completes successfully for a tenant/workspace
- **THEN** `in_falcone_mcp_tool_invocations_total` increases by 1 for the invocation's bounded label set with `status_class="success"`
- **AND** one observation is added to `in_falcone_component_operation_duration_seconds` for the same operation, reflecting the measured latency

#### Scenario: Tool-error outcome is recorded distinctly

- **WHEN** a tool invocation completes with an error result (`isError`)
- **THEN** the counter increments once with a non-success `status_class` (e.g. `error`) and the latency observation is still recorded
- **AND** the error outcome is distinguishable from success on the metrics plane without exposing the error payload as a label

#### Scenario: Denial surfaced as a completed invocation outcome

- **WHEN** a tool invocation is denied in a way that surfaces as a completed tool result (an `isError` denial rather than a pre-dispatch hard rejection)
- **THEN** the invocation is counted once with a non-success `status_class` reflecting the surfaced outcome
- **AND** a denial that aborts before the tool is invoked (for example a rate-limit or unknown-server rejection that throws) is not counted as a successful invocation and does not fabricate a success series

#### Scenario: No invocations means no fabricated series

- **WHEN** the process has served no MCP tool invocation for a given label set
- **THEN** neither family emits any series for that label set, and no zero-valued placeholder is rendered

#### Scenario: Valid Prometheus exposition

- **WHEN** a scraper reads `/metrics`
- **THEN** each new family is preceded by exactly one `# HELP` and one `# TYPE` line (`counter` for the invocations total, `histogram` for the duration), label values are escaped per the Prometheus text format, and the histogram renders cumulative `_bucket{...,le="..."}` samples using the contract bucket set plus `le="+Inf"`, `_sum`, and `_count`

### Requirement: Exactly-once accounting per completed MCP tool invocation

The system SHALL account each completed MCP tool invocation exactly once — one counter increment and one latency observation — regardless of whether the call arrived through the management API or the JSON-RPC transport, and SHALL NOT double-count a single invocation.

#### Scenario: Single invocation counts once

- **WHEN** exactly one tool invocation completes
- **THEN** the counter for its label set increases by exactly 1 and the histogram `_count` for its operation increases by exactly 1

#### Scenario: Both transports account identically

- **WHEN** the same tool is invoked once via the management `call_tool` API and once via the JSON-RPC `tools/call` path
- **THEN** each invocation is counted exactly once and both are attributed with the same bounded label semantics

#### Scenario: Repeated invocations accumulate monotonically

- **WHEN** N tool invocations complete within one process lifetime
- **THEN** the counter for the corresponding label set equals the number of those invocations and never decreases within the process lifetime

### Requirement: Telemetry export is fail-safe for tool calls

The system SHALL treat metrics export as best-effort: a failure while shaping or recording telemetry SHALL NOT alter, delay beyond a bounded in-process update, or fail the tool result returned to the caller.

#### Scenario: Recording failure does not break the call

- **WHEN** recording the invocation metric or latency raises an error (for example a label-policy violation)
- **THEN** the error is contained and the tool call still returns its normal result or JSON-RPC response
- **AND** the failure does not corrupt the already-exported legacy or MCP series

#### Scenario: Metrics collection unavailable

- **WHEN** the metrics sink is absent or disabled
- **THEN** MCP tool calls still execute and return normally, and `/metrics` continues to serve the remaining families

### Requirement: Bounded, non-PII labels attributed from verified identity

The system SHALL label the MCP families only with bounded dimensions that conform to the business-metrics and metrics-stack contracts, SHALL derive `tenant_id`, `workspace_id`, and `metric_scope` from the credential-verified identity and the resolved server rather than from caller- or message-supplied input, and SHALL NOT emit any forbidden (PII or high-cardinality) label.

#### Scenario: Contract-conformant label set

- **WHEN** the MCP families are rendered
- **THEN** every series carries the contract-required labels for its family and any additional dimension (`server`, `tool_name`, `oauth_client`, `status_class`, `operation`) is a bounded, non-PII identifier

#### Scenario: No forbidden label is ever exposed

- **WHEN** a tool invocation is recorded
- **THEN** no series carries `user_id`, `request_id`, `session_id`, `email`, `api_key_id`, `object_key`, `raw_path`, raw tool arguments, or any other forbidden-policy label

#### Scenario: Attribution cannot be spoofed cross-tenant (P13)

- **WHEN** a P13 tenant-B credential invokes a tool, and the JSON-RPC message carries a different tenant/workspace hint
- **THEN** the emitted `tenant_id`/`workspace_id`/`metric_scope` reflect only the verified identity and resolved server, never the message hint, so no activity is attributed to another tenant

### Requirement: Metrics exposition surface and trust boundary unchanged

The system SHALL export the MCP families through the already-existing `/metrics` endpoint without introducing a new endpoint, listener, route, or authentication change, and SHALL preserve the endpoint's current scrape trust boundary.

#### Scenario: Same endpoint, same content type

- **WHEN** a scraper reads `/metrics`
- **THEN** the response is served from the existing unauthenticated scrape endpoint with the unchanged `text/plain; version=0.0.4` content type as a single valid exposition document

#### Scenario: No new access surface (P13)

- **WHEN** the change is deployed
- **THEN** no additional endpoint, listener, gateway route, credential, or authentication requirement is introduced by exporting the MCP families

### Requirement: Counter reset and no fabricated series

The system SHALL treat the MCP families as in-process signals that reset on process restart, and SHALL NOT fabricate, pre-seed, or back-fill any series to imply activity that did not occur.

#### Scenario: Restart resets to a fresh baseline

- **WHEN** the executor process restarts
- **THEN** the MCP families are absent until the next real invocation, after which they resume from a fresh baseline as a normal counter reset (no carry-over of a fabricated prior value and no misleading decrease within a single lifetime)

#### Scenario: No synthetic zero series

- **WHEN** `/metrics` is scraped
- **THEN** no zero-valued or placeholder series is emitted for tool/tenant/workspace label sets that have had no real invocation, and no other cataloged family is emitted as a synthetic series

### Requirement: Legacy metrics exposition compatibility

The system SHALL preserve the existing five `falcone_*` HTTP/process families unchanged in name, labels, semantics, and exposition when the MCP families are added, so existing scrapers and dashboards continue to parse the endpoint.

#### Scenario: Legacy families intact alongside new families

- **WHEN** `/metrics` is scraped after the change
- **THEN** `falcone_http_requests_total`, `falcone_http_request_duration_seconds_{bucket,sum,count}`, and `falcone_process_uptime_seconds` are present with unchanged names, labels, and meaning, and the MCP families are additional rather than replacements

#### Scenario: Exposition remains a single valid document

- **WHEN** a Prometheus parser reads the endpoint
- **THEN** the combined output is one well-formed exposition with per-family `# HELP`/`# TYPE` and no duplicated or malformed family blocks

### Requirement: Operator documentation, troubleshooting, and rollback

The system SHALL document, for P17 operators, the two exported MCP families, their meaning and labels, what produces them (real MCP tool invocations with `MCP_ENABLED`), how to verify and troubleshoot their absence, and the additive, reversible rollback.

#### Scenario: Operator can identify the families

- **WHEN** a P17 operator consults the observability documentation
- **THEN** it names `in_falcone_mcp_tool_invocations_total` and the MCP slice of `in_falcone_component_operation_duration_seconds`, describes their labels and scopes, and states that they are produced only by real MCP tool calls

#### Scenario: Troubleshooting absence

- **WHEN** the families are absent from a scrape
- **THEN** the documentation explains the legitimate causes (MCP disabled, no tool invocations yet, or the executor process not being the scrape target) so absence is not mistaken for a defect

#### Scenario: Additive rollback

- **WHEN** an operator needs to revert the change
- **THEN** the documentation describes removing the export wiring as fully additive, leaving the legacy families and all other behavior unchanged

### Requirement: Scope boundary and non-goals for remaining families

The system SHALL limit this change to the two MCP-invocation-backed families and SHALL NOT introduce the remaining cataloged business/component families, collection-health/lag signals, or any UI, OpenAPI, gateway, new endpoint, authentication, or cluster change; their continued absence is intentional and tracked separately.

#### Scenario: Other families remain unexported

- **WHEN** `/metrics` is scraped after the change
- **THEN** only the two MCP families are added; tenant/workspace/api/identity/function/data-service/storage/realtime/quota families and the other `in_falcone_component_*`/collection-health families remain absent rather than faked

#### Scenario: No new product surface

- **WHEN** the change is delivered
- **THEN** no UI, OpenAPI/generated-client, gateway/APISIX route, new endpoint, authentication requirement, or Kubernetes/Helm change is introduced, and the REST `/v1/metrics/*` API is untouched
