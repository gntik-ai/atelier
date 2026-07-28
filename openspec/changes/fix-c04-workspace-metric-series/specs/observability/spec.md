# observability — spec delta for fix-c04-workspace-metric-series

## ADDED Requirements

### Requirement: Workspace metric series uses a closed supported-key contract

The system SHALL accept exactly `api_requests` and `api_errors` as `metricKey` values for the
public workspace metric-series operation. It SHALL derive both from
`falcone_http_requests_total`: `api_requests` SHALL represent the per-second rate of all matching
requests, and `api_errors` SHALL represent the per-second rate of matching requests whose HTTP
status is in the `5xx` class. The system SHALL NOT treat an unsupported key as an empty supported
series and SHALL NOT accept a raw metric name, label selector, or PromQL expression.

#### Scenario: Request-rate series is selected

- **WHEN** an authorized caller requests `metricKey=api_requests` for a resolved workspace with a
  valid window
- **THEN** the system queries the per-second rate of
  `falcone_http_requests_total` for all statuses under that workspace's exact tenant and workspace
  labels and returns `metricKey: api_requests`

#### Scenario: Server-error-rate series is selected

- **WHEN** an authorized caller requests `metricKey=api_errors` for a resolved workspace with a
  valid window
- **THEN** the system queries the per-second rate of
  `falcone_http_requests_total` restricted to `5xx` status labels under that workspace's exact
  tenant and workspace labels and returns `metricKey: api_errors`

#### Scenario: Storage history is unavailable

- **WHEN** a caller requests `metricKey=storage_bytes`
- **THEN** the system returns a stable HTTP `400` without querying Prometheus and does not
  fabricate, alias, or return a storage series

#### Scenario: Raw PromQL-like key is supplied

- **WHEN** a caller supplies a metric family name, label fragment, PromQL expression, or any key
  outside `api_requests` and `api_errors`
- **THEN** the system returns the same bounded HTTP `400` validation class before query
  construction or provider access

### Requirement: Workspace metric windows map to exact bounded queries

The system SHALL accept exactly `5m`, `1h`, `24h`, `7d`, and `30d` as workspace series windows. For
one captured integer end timestamp, it SHALL set `start` to exactly 300, 3,600, 86,400, 604,800, or
2,592,000 seconds before `end`, respectively, and SHALL use Prometheus steps of 5, 15, 300, 1,800,
or 7,200 seconds, respectively. The system SHALL NOT default, clamp, or reinterpret a missing or
unsupported window.

#### Scenario: Five-minute window is queried

- **WHEN** an authorized caller requests `window=5m`
- **THEN** the Prometheus range is exactly 300 seconds and its step is exactly 5 seconds

#### Scenario: One-hour window is queried

- **WHEN** an authorized caller requests `window=1h`
- **THEN** the Prometheus range is exactly 3,600 seconds and its step is exactly 15 seconds

#### Scenario: Twenty-four-hour window is queried

- **WHEN** an authorized caller requests `window=24h`
- **THEN** the Prometheus range is exactly 86,400 seconds and its step is exactly 300 seconds

#### Scenario: Seven-day window is queried

- **WHEN** an authorized caller requests `window=7d`
- **THEN** the Prometheus range is exactly 604,800 seconds and its step is exactly 1,800 seconds

#### Scenario: Thirty-day window is queried

- **WHEN** an authorized caller requests `window=30d`
- **THEN** the Prometheus range is exactly 2,592,000 seconds and its step is exactly 7,200 seconds,
  bounding the query to no more than 361 inclusive evaluation timestamps

### Requirement: Required workspace-series parameters fail closed

The system SHALL return a stable HTTP `400` when `metricKey` or `window` is missing, empty,
repeated ambiguously, malformed, or outside its closed allowlist. It SHALL perform this validation
before querying Prometheus. This requirement SHALL NOT change the shared runtime
`ErrorResponse` envelope tracked by C-02.

#### Scenario: Metric key is missing

- **WHEN** a caller requests a workspace metric series without `metricKey`
- **THEN** the system returns HTTP `400` and does not contact Prometheus

#### Scenario: Window is missing

- **WHEN** a caller requests a workspace metric series without `window`
- **THEN** the system returns HTTP `400` and does not contact Prometheus

#### Scenario: Parameter is empty or ambiguous

- **WHEN** a caller supplies an empty value or repeated conflicting values for `metricKey` or
  `window`
- **THEN** the system returns the same stable HTTP `400` validation class without choosing a
  default or one of the conflicting values

#### Scenario: Window is unknown

- **WHEN** a caller supplies a window other than `5m`, `1h`, `24h`, `7d`, or `30d`
- **THEN** the system returns HTTP `400` without calculating or issuing a provider range query

### Requirement: Workspace series is isolated by resolved tenant and workspace

The system SHALL resolve the path workspace through the existing workspace lookup, SHALL apply the
existing authentication and authorization decision, and SHALL build every authorized workspace
Prometheus selector with exact matchers for both the resolved owning `tenant_id` and the resolved
canonical `workspace_id`. It SHALL escape Prometheus label-string metacharacters without
destructively normalizing distinct identifiers. It SHALL NOT derive either selector from request
query/body values, untrusted identity headers, or an unresolved path value.

#### Scenario: Sibling workspaces in one tenant are queried

- **WHEN** the same authorized tenant has sibling workspaces `wrk_alpha` and `wrk_beta` and each
  workspace series is requested
- **THEN** each PromQL selector contains the same resolved `tenant_id` and its own exact
  `workspace_id`, so neither query selects the sibling's labeled samples

#### Scenario: Resolved identifiers contain label metacharacters

- **WHEN** a trusted resolved tenant or workspace identifier contains a backslash, double quote,
  or line-break character accepted by the backing store
- **THEN** the system escapes the value as Prometheus label-string data and does not remove
  characters, alias it to another identifier, or allow it to alter the matcher

#### Scenario: Client attempts to override scope

- **WHEN** a caller includes a tenant label, workspace label, metric selector, or PromQL fragment
  in query parameters, body content, or untrusted headers
- **THEN** the system ignores it as scope authority or rejects it as invalid and constructs no
  selector outside the resolved tenant/workspace pair

#### Scenario: Workspace is foreign or unknown

- **WHEN** an authenticated caller requests a foreign or unknown workspace
- **THEN** the system preserves the existing outcomes (`403 FORBIDDEN` for a known foreign workspace
  and `404 WORKSPACE_NOT_FOUND` for an unknown workspace), exposes no owning tenant, metric labels,
  PromQL, points, counts, or provider detail, and does not query Prometheus

### Requirement: HTTP request counters carry only trusted conditional workspace labels

The system SHALL make both the control-plane and executor HTTP metric producers attach a
`workspace_id` label to `falcone_http_requests_total` when and only when a non-empty workspace has
been obtained from the runtime's existing trusted scope boundary. The control-plane SHALL use the
canonical workspace and owning tenant resolved after the existing authentication and authorization
boundary, independently of the final HTTP status; the executor SHALL use its workspace identity
only after its existing credential-binding or ownership checks.
Both SHALL retain the current normalized `route`, `method`, and `status` labels and SHALL keep
platform, tenant-only, anonymous, health, unmatched, and otherwise unscoped series compatible by
omitting `workspace_id`.

#### Scenario: Control-plane handles a resolved workspace request

- **WHEN** the control-plane completes a request whose workspace has been trusted or canonically
  resolved under the existing route and authorization flow
- **THEN** its HTTP counter sample includes that exact `workspace_id` and the workspace's resolved
  owning `tenant_id`, even when a privileged token carries another or no tenant context

#### Scenario: Executor handles a resolved workspace request

- **WHEN** the executor completes a request whose workspace has been trusted or canonically
  resolved under the existing route and scope checks
- **THEN** its HTTP counter sample includes that exact `workspace_id` under the same label
  semantics as the control-plane producer

#### Scenario: Request has no trusted workspace

- **WHEN** either runtime records a platform, tenant-only, anonymous, health, unmatched, or other
  request for which no workspace was trusted or resolved
- **THEN** the counter sample omits `workspace_id` rather than emitting an empty, anonymous,
  client-supplied, or unresolved workspace label

#### Scenario: Untrusted workspace header is supplied

- **WHEN** a client supplies a workspace header that has not passed the runtime's existing trust
  and scope-resolution boundary
- **THEN** neither runtime uses that value as a metric label

#### Scenario: Executor public probe carries workspace identity input

- **WHEN** an executor `healthz` or `readyz` request carries a gateway-trusted workspace header, a
  workspace-bound credential, or a client header accepted by legacy development mode
- **THEN** the probe keeps its existing response and its HTTP counter omits `workspace_id` because
  the public route has no canonical workspace scope

#### Scenario: Workspace route is rejected or unknown

- **WHEN** the control-plane rejects a foreign workspace request or cannot resolve the requested
  workspace
- **THEN** it does not promote the raw path workspace or a client header into `workspace_id`

#### Scenario: Tenant-only route uses a workspace-bound identity

- **WHEN** the control-plane handles a route with no canonical workspace path even though the
  verified identity contains a workspace claim
- **THEN** the request counter remains tenant-scoped and omits `workspace_id`

### Requirement: Every successful workspace series conforms to MetricSeriesResponse

The system SHALL include `tenantId`, `workspaceId`, `metricKey`, `window`, and `points` in every
HTTP `200` workspace series response and MAY include `unit`. The identifiers SHALL be the resolved
scope, the key and window SHALL be the validated request values, and `points` SHALL be an array of
objects containing an RFC 3339 `timestamp` and finite numeric `value`. The response SHALL NOT
contain `source` or any other property disallowed by `MetricSeriesResponse`.

#### Scenario: Prometheus returns usable samples

- **WHEN** Prometheus successfully returns usable samples for an authorized valid workspace query
- **THEN** the system returns those real samples in provider order with the resolved tenant and
  workspace, accepted metric key and window, optional `requests_per_second` unit, and no
  additional property

#### Scenario: Provider returns an unusable sample

- **WHEN** a provider result contains an invalid timestamp or a non-finite numeric value
- **THEN** the system does not fabricate or coerce that sample into a valid-looking point and
  returns only usable real points or the empty degradation response

#### Scenario: Response contract is validated

- **WHEN** a success or degradation body is checked against the published
  `MetricSeriesResponse`
- **THEN** it passes required-field, point-shape, enum, and additional-property validation

### Requirement: Prometheus degradation is empty, scoped, and truthful

The system SHALL degrade Prometheus timeout/unreachability, non-success response, invalid JSON,
unsuccessful payload, missing result, or unusable result to HTTP `200` with an empty
`MetricSeriesResponse` for the resolved tenant/workspace and validated key/window. It SHALL NOT
fabricate zero-valued points, interpolate gaps, merge legacy tenant-only samples, expose provider
detail, or add a `source` property.

#### Scenario: Prometheus is unavailable or unreachable

- **WHEN** Prometheus times out, cannot be reached, or responds with a non-success HTTP status
- **THEN** the authorized caller receives `points: []` with the resolved `tenantId`,
  `workspaceId`, accepted `metricKey`, and accepted `window`, and receives no provider URL,
  response, exception, query, or `source`

#### Scenario: Prometheus payload is malformed

- **WHEN** Prometheus returns invalid JSON, an unsuccessful payload, no result, or no usable series
- **THEN** the system returns the same empty conforming scoped series without invented values

#### Scenario: Legacy samples lack workspace labels

- **WHEN** Prometheus retains tenant-only samples emitted before workspace labeling was deployed
- **THEN** the workspace query excludes those samples and may truthfully return an empty or
  partial warm-up series rather than attributing tenant-wide history to the workspace

### Requirement: Workspace series preserves existing authorization and persona boundaries

The system SHALL preserve the existing authentication, authorization, workspace membership,
actor-type, superadmin, and denial behavior for the workspace series operation and SHALL NOT
expand any role. The corrected data semantics SHALL apply only after the caller has passed the
existing boundary.

#### Scenario: P7 or P9 has existing permission

- **WHEN** a workspace owner/administrator (P7) or workspace operator/application DevOps user
  (P9) is authorized by the existing policy to read the selected workspace
- **THEN** the system returns the corrected scoped series without granting any additional
  operation or workspace access

#### Scenario: P10 is a constrained read-only caller

- **WHEN** a scoped viewer or auditor (P10) uses the operation under its existing authorization
- **THEN** the caller remains read-only, receives the corrected series only if already permitted,
  and gains no mutation, quota, export, or cross-workspace capability

#### Scenario: Adjacent or machine persona is denied

- **WHEN** a platform operator (P3), security/compliance auditor (P4), or service workload (P12)
  lacks permission under the existing policy
- **THEN** the existing denial remains in force and this change does not reinterpret the role,
  grant, credential, or actor type

#### Scenario: Other-tenant actor attempts access

- **WHEN** a valid actor from another tenant (P13) presents a foreign workspace identifier
- **THEN** the request fails closed under the existing non-enumerating boundary and returns no
  series data or scope metadata

### Requirement: Workspace series remains read-only and governance-neutral

The system SHALL keep the workspace series operation as a non-mutating GET. It SHALL emit the
normal HTTP request counter and latency telemetry but SHALL NOT emit a domain audit event, write
application or metric data, consume or modify quota, change a rate-limit class, or introduce
credentials, user identifiers, raw headers, queries, Prometheus responses, or response content as
metric labels.

#### Scenario: Authorized series GET completes

- **WHEN** an authorized valid workspace series request succeeds with points or empty degradation
- **THEN** normal request metrics record the request and no domain audit record, data mutation,
  quota consumption, or quota-policy change occurs

#### Scenario: Invalid series GET completes

- **WHEN** a workspace series request is rejected for an invalid key or window
- **THEN** normal request telemetry may record its final status while no domain audit event,
  provider query, data write, or quota mutation occurs

#### Scenario: Metric-label governance is inspected

- **WHEN** the HTTP counter output from either runtime is reviewed
- **THEN** workspace cardinality is bounded to trusted/resolved workspace identifiers and no
  credential, subject, raw identity header, query string, provider payload, or arbitrary
  client-controlled label is present

### Requirement: Console workspace-series behavior remains compatible

The system SHALL keep the existing console behavior that requests `api_requests` for the selected
supported workspace window and consumes `MetricSeriesResponse.points`. It SHALL retain the
workspace presets `24h`, `7d`, and `30d` without adding a metric selector, custom range, page,
interaction, copy, or visual change.

#### Scenario: Console selects a supported preset

- **WHEN** a console user selects `24h`, `7d`, or `30d` while a workspace is active
- **THEN** the console requests that workspace's series with `metricKey=api_requests` and the
  selected `window` and renders the returned points through its existing behavior

#### Scenario: Console receives empty degradation

- **WHEN** the series operation returns a conforming response with `points: []`
- **THEN** the console preserves its current empty-series handling without relying on a `source`
  property or treating fabricated zeroes as measurements

### Requirement: Public contract and focused documentation describe the bounded behavior

The system SHALL publish `api_requests` and `api_errors` as the workspace operation's
`metricKey` enum, retain the five window enum values and closed `MetricSeriesResponse`, and
document the metric meanings, exact range/step mapping, tenant-plus-workspace selection,
workspace-label warm-up boundary, empty degradation behavior, and focused local validation
commands in the existing observability metric time-range reference.

#### Scenario: API consumer inspects the workspace operation

- **WHEN** an API consumer reads the canonical OpenAPI operation
- **THEN** required key/window parameters expose only the supported enums and every documented
  `200` body uses `MetricSeriesResponse`

#### Scenario: Maintainer reads the time-range reference

- **WHEN** a maintainer consults
  `docs/reference/architecture/observability-metrics-time-range.md`
- **THEN** the reference explains both keys, all exact range/step mappings, workspace isolation,
  warm-up compatibility, truthful empty degradation, unchanged console presets, and local
  verification without claiming live validation
