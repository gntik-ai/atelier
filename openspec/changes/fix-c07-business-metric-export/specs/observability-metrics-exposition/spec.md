# observability-metrics-exposition — spec delta for fix-c07-business-metric-export

## ADDED Requirements

### Requirement: Real MCP invocations export exactly two metric families

The executor SHALL export `in_falcone_mcp_tool_invocations_total` as a counter and SHALL export
`in_falcone_component_operation_duration_seconds` as a histogram for
`subsystem="mcp"`, `operation="tool_call"`. It SHALL derive both families only from a real MCP tool
invocation after credential verification, tenant-scoped server resolution, active-version
resolution, and canonical published-tool resolution. This implementation SHALL emit only verified
`tenant` or `workspace` scope and SHALL NOT emit an MCP invocation tuple with
`metric_scope="platform"`. It SHALL NOT derive either family from a catalog entry, audit record,
log, HTTP request count, quota value, or synthetic/back-filled event.

#### Scenario: Successful workspace MCP tool invocation

- **WHEN** a canonically resolved MCP tool completes successfully for a verified tenant and
  resolved workspace
- **THEN** the counter increases by exactly `1` with `status_class="success"`
- **AND** the MCP tool-call histogram receives exactly one finite non-negative latency observation
  for the same verified scope and canonical attribution dimensions

#### Scenario: Known tool completes with an error

- **WHEN** a canonically resolved MCP tool completes with a validation, dispatch, backend, or other
  non-authorization tool-error result
- **THEN** the counter increases by exactly `1` with `status_class="error"`
- **AND** the histogram receives exactly one latency observation without exposing error text,
  arguments, or result content as a label

#### Scenario: Known tool returns an observable denial

- **WHEN** a canonically resolved tool reaches its scope/authorization decision and completes with
  a tool-level denied result
- **THEN** the counter increases by exactly `1` with `status_class="denied"`
- **AND** the histogram receives exactly one latency observation without deriving the outcome by
  parsing caller-visible error text

#### Scenario: Request fails before canonical invocation attribution

- **WHEN** a request is unauthenticated, addresses a foreign/unknown or inactive server, has a
  missing/unknown tool, is malformed, reaches a rate limit before canonical attribution, or is
  otherwise rejected before a canonical tool invocation begins
- **THEN** it creates no MCP invocation counter or histogram sample, does not create a label from
  the attempted tool/server value, and does not fabricate a success, error, or denied invocation

#### Scenario: No verified tenant scope exists

- **WHEN** telemetry shaping is attempted without a credential-verified tenant identity
- **THEN** the executor rejects the pair and emits no MCP invocation tuple rather than falling back
  to `metric_scope="platform"`

### Requirement: Completed outcomes use an internal exhaustive classification

For a requested tool, the MCP invocation path SHALL return the caller-visible result together with
an internal `outcomeClass` used by both metric descriptors. It SHALL set `outcomeClass` to
`success` only for an HTTP 200-299 backend response; `denied` when the caller lacks `BASE_SCOPE` or
lacks the canonical mutating tool's declared required scope; and `error` for an invalid published
mutating tool with no declared required scope, argument/call-resolution validation failure,
backend response outside HTTP 200-299, or unavailable backend. An unknown requested tool SHALL
remain a pre-attribution result with no `outcomeClass` and no metric pair. Metric classification
SHALL NOT inspect or parse caller-visible error text, result content, or audit detail.

#### Scenario: Caller lacks the MCP base scope

- **WHEN** a canonical tool is resolved but the verified caller lacks `BASE_SCOPE`
- **THEN** the caller-visible missing-scope result is paired with internal
  `outcomeClass="denied"` and exactly one denied counter/histogram pair is recorded

#### Scenario: Caller lacks a mutating tool's declared scope

- **WHEN** a canonical mutating tool declares a required scope and the verified caller lacks it
- **THEN** the caller-visible missing-scope result is paired with internal
  `outcomeClass="denied"` and exactly one denied counter/histogram pair is recorded

#### Scenario: Published mutating tool has no declared scope

- **WHEN** a canonical mutating tool has neither an explicit scope nor a suggested scope
- **THEN** its validation result is paired with internal `outcomeClass="error"` and exactly one
  error counter/histogram pair is recorded

#### Scenario: Canonical call validation fails

- **WHEN** a canonical tool cannot resolve a valid backend call because required arguments or
  another call-shape constraint fails
- **THEN** its validation result is paired with internal `outcomeClass="error"` and exactly one
  error counter/histogram pair is recorded

#### Scenario: Backend returns outside HTTP 200-299

- **WHEN** the canonical backend call completes with an HTTP status outside 200-299
- **THEN** the caller-visible backend result is paired with internal `outcomeClass="error"` and
  exactly one error counter/histogram pair is recorded

#### Scenario: Backend is unavailable

- **WHEN** dispatch of a canonical tool fails because its backend cannot be reached
- **THEN** the caller-visible unavailable result is paired with internal `outcomeClass="error"`
  and exactly one error counter/histogram pair is recorded

#### Scenario: Backend returns HTTP 200-299

- **WHEN** dispatch of a canonical tool completes with an HTTP 200-299 backend response
- **THEN** its caller-visible result is paired with internal `outcomeClass="success"` and exactly
  one success counter/histogram pair is recorded

#### Scenario: Requested tool is not in the active manifest

- **WHEN** the requested tool name does not resolve to a canonical tool in the active published
  manifest
- **THEN** the unknown-tool result has no `outcomeClass`, submits no metric pair, and does not use
  the requested string as `tool_name`

### Requirement: One shared seam accounts each invocation exactly once

The executor SHALL submit one counter/histogram pair from the shared MCP `call_tool` completion
seam for every in-scope invocation. With a functioning metrics sink it SHALL record exactly one
counter increment and one histogram observation. The management operation and JSON-RPC
`tools/call` transport SHALL use that same seam and SHALL NOT add transport-specific accounting or
double count.

#### Scenario: Management operation completes once

- **WHEN** one tool invocation completes through the management `call_tool` operation
- **THEN** exactly one pair is submitted, its counter changes by `1`, and its histogram `_count`
  changes by `1`

#### Scenario: JSON-RPC tools/call completes once

- **WHEN** one tool invocation completes through JSON-RPC `tools/call`
- **THEN** delegation to the shared `call_tool` seam records exactly one pair and the JSON-RPC
  wrapper records no second pair

#### Scenario: Multiple invocations remain monotonic within one process

- **WHEN** N in-scope invocations with the same label tuple complete while one executor process is
  running and the sink remains healthy
- **THEN** the counter and histogram `_count` for that tuple each increase by exactly N and never
  decrease during that process lifetime

### Requirement: Telemetry is best-effort, atomic, and non-interfering

The registry sink SHALL expose one MCP-specific mutating operation that accepts the complete
counter/histogram pair and SHALL NOT expose separate counter and histogram mutations for this
path. It SHALL validate the immutable pair, clone or calculate the complete next combined
counter/histogram aggregate away from published state, and publish both halves through one final
state commit. Any exception before that commit SHALL leave both MCP aggregates and their two
rendered family blocks byte-for-byte unchanged. No fallible recording work SHALL occur after the
commit. The executor SHALL contain shaping, validation, and sink errors, SHALL NOT retry, and
SHALL preserve the caller-visible tool or JSON-RPC outcome. An absent or failing metrics sink MAY
create an observability gap, but SHALL NOT cause a counter-only or histogram-only update, corrupt
an existing series, duplicate an invocation, or fail the business operation.

#### Scenario: Pair is accepted atomically

- **WHEN** both descriptors and all label values pass policy validation
- **THEN** the sink computes both next values from one snapshot and publishes them in one commit
  through its pair-only operation

#### Scenario: Validation or next-state calculation fails before commit

- **WHEN** descriptor validation, cloning, or calculation of either next aggregate throws before
  the final commit
- **THEN** neither half is retained, the combined MCP aggregate and both MCP family blocks are
  byte-for-byte identical to their pre-call values, no automatic retry occurs, and the tool call
  returns the same result it would return without the telemetry failure

#### Scenario: Separate half-mutation is attempted

- **WHEN** a caller attempts to record only the invocation counter or only the latency histogram
- **THEN** the MCP registry exposes no such mutation interface and published state remains
  unchanged

#### Scenario: Metrics sink is absent

- **WHEN** an MCP engine is constructed without a metrics sink
- **THEN** tool calls and JSON-RPC responses preserve their current behavior and `/metrics`
  continues to serve its remaining families

### Requirement: MCP metric labels follow an explicit safe contract

The business-metrics contract SHALL set the MCP counter's supported scopes to exactly `tenant` and
`workspace`. Every emitted counter series SHALL contain exactly the required labels
`environment`, `subsystem`, `metric_scope`, `collection_mode`, `domain`, `metric_type`,
`feature_area`, `operation_family`, `tenant_id`, `server`, `tool_name`, and `status_class`, plus
`workspace_id` exactly when `metric_scope="workspace"` and `oauth_client` only when a verified
non-secret OAuth client identifier exists. The fixed values SHALL be `subsystem="mcp"`,
`collection_mode="push"`, `domain="mcp_tool_usage"`, `metric_type="usage"`,
`feature_area="mcp"`, and `operation_family="execute"`.

The metrics-stack contract SHALL add an explicit `mcp`/`tool_call` slice policy to
`in_falcone_component_operation_duration_seconds`. Every emitted histogram series in that slice
SHALL contain exactly the required labels `environment`, `subsystem`, `metric_scope`,
`collection_mode`, `operation`, `tenant_id`, `server`, `tool_name`, and `status_class`, plus
`workspace_id` exactly when `metric_scope="workspace"` and `oauth_client` only when the same
verified client identifier exists. Its fixed values SHALL be `subsystem="mcp"`,
`collection_mode="push"`, and `operation="tool_call"`. For both families `metric_scope` SHALL be
exactly `tenant` or `workspace`, and `status_class` SHALL be exactly `success`, `error`, or
`denied`. This slice rule SHALL NOT add a generic optional-label allowance to the normalized
histogram family or permit these labels for any other subsystem/operation slice.

#### Scenario: Counter descriptor and manifest agree

- **WHEN** the MCP counter descriptor is checked against
  `observability-business-metrics.json`
- **THEN** its supported scopes are exactly tenant/workspace, `tenant_id`, `server`, `tool_name`,
  and `status_class` are required, `workspace_id` and `oauth_client` obey their conditional rules,
  the status enum is bounded, and no undeclared label is present

#### Scenario: Histogram descriptor and metrics stack agree

- **WHEN** the MCP latency descriptor is checked against `observability-metrics-stack.json`
- **THEN** it matches the explicit MCP tool-call slice's exact required, conditional, fixed, scope,
  source, and outcome rules without loosening another subsystem's normalized histogram slice

#### Scenario: Invalid label key, scope, or outcome is offered

- **WHEN** a descriptor contains an undeclared label key, `metric_scope="platform"`, or a status
  other than `success`, `error`, or `denied`
- **THEN** the metrics sink rejects the complete pair before mutation and the best-effort
  containment requirement preserves the tool result

#### Scenario: Another histogram slice uses an MCP attribution label

- **WHEN** a normalized duration descriptor has a subsystem/operation match other than
  `mcp`/`tool_call` and contains `server`, `tool_name`, `oauth_client`, or `status_class` solely
  because the MCP policy permits it
- **THEN** contract validation rejects the descriptor because the MCP slice grants no generic
  cardinality permission

### Requirement: Scope and attribution labels come from verified canonical sources

The executor SHALL derive `tenant_id` from credential-verified tenant identity,
`workspace_id` from the tenant-resolved MCP server, `server` from that canonical server record,
`tool_name` from the active published manifest, and `oauth_client` only from a verified non-secret
OAuth client identity. It SHALL set `metric_scope` consistently with the verified tenant/workspace
labels, SHALL always include `tenant_id`, `server`, and `tool_name`, and SHALL omit only the
conditional `workspace_id` or optional `oauth_client` when their source is unavailable. It SHALL
NOT take any of these values from JSON-RPC params, tool arguments, raw path/query values,
unverified headers, or another caller-supplied scope hint, and SHALL NOT invent a platform-scope
fallback.

#### Scenario: Verified workspace invocation is attributed

- **WHEN** a verified OAuth client invokes a canonical tool on a resolved workspace MCP server
- **THEN** both families use the verified tenant, resolved workspace/server, active-manifest tool,
  verified OAuth client, and `metric_scope="workspace"`

#### Scenario: Optional OAuth client identifier is not verified

- **WHEN** the verified runtime context does not contain a safe non-secret OAuth client identifier
- **THEN** the executor omits `oauth_client` rather than emitting a raw claim, subject, token,
  secret, generic `system`, or other fabricated identity label

#### Scenario: Verified tenant invocation has no workspace

- **WHEN** a verified tenant invokes a canonical tool on a tenant-scoped resolved MCP server with
  no workspace attribution
- **THEN** both families contain `metric_scope="tenant"` and the verified `tenant_id`, omit
  `workspace_id`, and retain canonical `server` and `tool_name`

#### Scenario: Caller attempts cross-tenant attribution

- **WHEN** a P13 tenant-B caller supplies tenant-A/workspace-A hints or addresses a tenant-A server
- **THEN** the hints never affect metric labels, tenant-scoped server resolution retains its
  existing non-enumerating denial, and the attempt creates no tenant-A/workspace-A/server/tool
  series or existence disclosure

### Requirement: Cardinality and sensitive-data controls are enforced

The executor SHALL bound MCP series cardinality to the verified tenant/workspace, registered
tenant-scoped server, canonical tool in an active published manifest, verified OAuth client
inventory, fixed operation/business dimensions, and the three-value status enum. It SHALL NOT
emit PII, credentials, secrets, raw identity claims, arbitrary request strings, or forbidden
high-cardinality fields as labels.

#### Scenario: Canonical inventory bounds cardinality

- **WHEN** a valid invocation is recorded
- **THEN** its dynamic identifier values belong to the existing verified tenant-scoped MCP server,
  active-tool, and OAuth-client inventories rather than an arbitrary request namespace

#### Scenario: Unknown tool-name flood is attempted

- **WHEN** a caller sends any number of distinct names that do not resolve in the active published
  manifest
- **THEN** none of those strings creates a `tool_name` label or a new MCP invocation series

#### Scenario: Forbidden or sensitive data is inspected

- **WHEN** the exported label keys and values are reviewed
- **THEN** they contain no `user_id`, `request_id`, `session_id`, email, `api_key_id`,
  authorization header, token, secret, raw path/query, workspace/tenant slug, object key, raw tool
  argument, error message, or result content

### Requirement: Prometheus text exposition is complete and valid

The executor SHALL render each new family with one static `# HELP` and one static `# TYPE` line,
using `counter` for `in_falcone_mcp_tool_invocations_total` and `histogram` for
`in_falcone_component_operation_duration_seconds`. It SHALL escape label-string backslashes,
double quotes, and line breaks according to the Prometheus text format. Histogram observations
SHALL be finite non-negative seconds and SHALL render cumulative buckets at `0.005`, `0.01`,
`0.025`, `0.05`, `0.1`, `0.25`, `0.5`, `1`, `2.5`, `5`, and `10`, plus `+Inf`, followed by
finite `_sum` and integer `_count` samples.

#### Scenario: Counter family is rendered

- **WHEN** at least one MCP invocation tuple has been recorded and a scraper reads `/metrics`
- **THEN** the output has exactly one counter HELP/TYPE declaration and one correctly escaped
  counter sample per active label tuple

#### Scenario: Histogram family is rendered

- **WHEN** at least one latency observation has been recorded and a scraper reads `/metrics`
- **THEN** the output has exactly one histogram HELP/TYPE declaration, cumulative finite buckets
  in the contractual order, `le="+Inf"` equal to `_count`, and matching `_sum`/`_count` for each
  active label tuple

#### Scenario: Label contains exposition metacharacters

- **WHEN** a permitted canonical identifier contains a backslash, double quote, LF, or CR/LF
- **THEN** it remains one label value after escaping and cannot inject or alter a label, sample,
  HELP line, TYPE line, or family

#### Scenario: Combined document is parsed

- **WHEN** a Prometheus-compatible parser reads the complete response
- **THEN** it accepts one document with no duplicate/malformed metadata block, invalid numeric
  value, non-cumulative bucket, or histogram count mismatch

### Requirement: Empty and restart states contain no fake samples

The executor SHALL create an MCP sample tuple only after a real post-start invocation for that
tuple. It SHALL NOT pre-seed, render a zero placeholder, persist, replay, infer, back-fill, or copy
an earlier process value. Static HELP/TYPE metadata MAY be present without samples. Counter and
histogram values SHALL be monotonic within a process lifetime and SHALL reset by becoming absent on
process restart until new real activity occurs.

#### Scenario: MCP is enabled but idle

- **WHEN** the executor has completed no MCP tool invocation since process start
- **THEN** `/metrics` contains no MCP counter, bucket, sum, or count sample line, even if static
  HELP/TYPE metadata is present

#### Scenario: A label tuple has no activity

- **WHEN** other MCP tuples have activity but a particular tenant/workspace/server/tool/client
  tuple has never completed an invocation
- **THEN** no zero-valued or placeholder series is rendered for that inactive tuple

#### Scenario: Executor restarts

- **WHEN** a process that contained MCP aggregates is replaced by a fresh executor process
- **THEN** old tuples are absent, no prior value is fabricated or replayed, and the first real
  post-start invocation begins a fresh Prometheus counter/histogram lifetime

### Requirement: Legacy metrics and the scrape trust boundary remain compatible

The executor SHALL preserve the current `GET /metrics` and `/metrics/` handler, listener, method
behavior, authentication/network trust boundary, and
`text/plain; version=0.0.4; charset=utf-8` content type. It SHALL preserve the names, labels,
values, semantics, and HELP/TYPE meaning of `falcone_http_requests_total`,
`falcone_http_request_duration_seconds_bucket`,
`falcone_http_request_duration_seconds_sum`,
`falcone_http_request_duration_seconds_count`, and `falcone_process_uptime_seconds`. It SHALL NOT
add a path, listener, gateway route, credential, or tenant-filtered scrape behavior.

#### Scenario: New and legacy families share the existing endpoint

- **WHEN** `/metrics` is scraped after MCP activity
- **THEN** the two additive MCP families and all five legacy sample families form one valid
  exposition document with the unchanged content type

#### Scenario: Scrape occurs before MCP activity

- **WHEN** the same endpoint is scraped before any MCP invocation
- **THEN** all legacy output remains available and unchanged while no MCP sample is fabricated

#### Scenario: P13 remains outside the scrape boundary

- **WHEN** an actor outside the current internal scrape trust boundary probes the deployment after
  this change
- **THEN** it gains no new endpoint, listener, gateway mapping, credential, or authentication path
  to metrics

#### Scenario: Existing scrape reader remains process-wide

- **WHEN** a caller already authorized by the existing scrape boundary reads `/metrics`
- **THEN** the existing process-wide visibility model remains in force; this change does not claim
  to add per-caller or per-tenant filtering

### Requirement: The separate control-plane process does not synthesize MCP activity

The separate control-plane metrics registry SHALL preserve its existing locally produced
HTTP/process exposition and SHALL NOT mirror executor MCP activity or emit an MCP sample without a
local real MCP invocation producer.

#### Scenario: Control-plane metrics are scraped

- **WHEN** a scraper targets the separate control-plane process rather than the MCP executor
- **THEN** it receives that process's existing local families and no mirrored, placeholder, or
  zero-valued executor MCP series

### Requirement: Remaining catalog families are explicit non-goals

The system SHALL limit C07 to `in_falcone_mcp_tool_invocations_total` and the MCP tool-call slice of
`in_falcone_component_operation_duration_seconds`. It SHALL NOT implement or emit synthetic
tenant/workspace lifecycle, API, identity, function, data-service, storage, realtime, quota,
component availability/error/probe, collection-health, collection-failure, or collection-lag
families. It SHALL NOT change UI, dashboards, alerts, OpenAPI/clients, public REST metrics,
gateway/APISIX, routes/listeners, authentication/authorization, deployments, Helm, or cluster
configuration.

#### Scenario: Other families have no real producer

- **WHEN** `/metrics` is scraped after this change
- **THEN** no remaining cataloged family is rendered as a sample or fake zero merely because its
  name exists in an internal contract

#### Scenario: Product and deployment surfaces are inspected

- **WHEN** the C07 implementation diff is reviewed
- **THEN** it contains no UI, OpenAPI/generated-client, public REST metric, gateway, new route,
  listener, authentication, authorization, deployment, chart, or Kubernetes change

### Requirement: Operator documentation covers production, troubleshooting, and rollback

The system SHALL document for P1/P3/P4/P7/P9/P10/P12/P17 the two exported family names, their
counter/histogram meanings, outcome classes, labels, verified/canonical attribution sources,
histogram buckets, unchanged scrape boundary, real-activity empty state, process-reset behavior,
local verification, troubleshooting, and additive rollback. It SHALL state that absence is unknown
or no post-start production, not historical zero usage.

#### Scenario: Operator verifies normal production

- **WHEN** a P3 operator or P17 documentation maintainer follows the reference after a real MCP
  tool call
- **THEN** the documented local check identifies one counter increment and one latency observation
  with the expected verified scope and outcome class

#### Scenario: Operator troubleshoots missing samples

- **WHEN** the MCP sample families are absent
- **THEN** the reference checks MCP enablement, post-start canonical tool activity, executor versus
  control-plane scrape target, recent restart, telemetry validation, and exposition parsing without
  interpreting absence as a zero or requiring a cluster

#### Scenario: Operator rolls back the export

- **WHEN** an operator must remove the C07 wiring
- **THEN** the reference describes reverting the two-family sink/registry/contract/docs change with
  no datastore cleanup and with all legacy metrics and the existing `/metrics` boundary preserved

### Requirement: Local automated evidence covers the public and contract boundaries

The C07 regression suite SHALL include registry and engine unit tests, public HTTP black-box tests
through both MCP call transports and `/metrics`, manifest/metrics-stack contract tests, legacy
compatibility, P13 attribution/isolation controls, empty/restart coverage, documentation checks,
and Prometheus-format validation. The public tests SHALL use ephemeral loopback ports and
temporary/in-memory fixtures and SHALL NOT require Docker, an external network, a shared service,
repository writes, or Kubernetes.

#### Scenario: Public black-box suite runs

- **WHEN** the focused black-box suite invokes a real fixture tool through management HTTP and
  JSON-RPC and then scrapes `/metrics`
- **THEN** it proves success/error/observable-denial accounting, exactly-once transport behavior,
  verified attribution, P13 spoofing controls, legacy compatibility, and valid exposition using
  only hermetic local resources

#### Scenario: Contract and format validation run

- **WHEN** the focused contract/validation commands execute
- **THEN** the business-metrics label allowlist/outcome enum, metrics-stack bucket vector, runtime
  descriptor, and Prometheus text output agree deterministically; if optional `promtool` is absent,
  an equivalent deterministic parser check runs instead of silently skipping validation

#### Scenario: Strict OpenSpec validation runs

- **WHEN** a maintainer executes
  `openspec validate fix-c07-business-metric-export --strict`
- **THEN** the change validates without accessing or mutating a cluster
