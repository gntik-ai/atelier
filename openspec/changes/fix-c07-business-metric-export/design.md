# Design: Real MCP business-metric export

## Context

The executor and control-plane processes each have a zero-dependency, process-local registry and an
existing unauthenticated `/metrics` handler whose reachability is controlled outside the handler.
Only the executor hosts the MCP engine. Its current registry renders HTTP request counters,
HTTP-duration histogram samples, and process uptime; it has no generic descriptor ingestion.

The MCP engine already creates a counter descriptor and a histogram descriptor after
`invokeTool(...)` resolves. The management `call_tool` operation reaches this code directly and
the JSON-RPC `tools/call` handler delegates to the same operation. The engine currently consumes
only `telemetry.log` for audit detail, so the two metric descriptors are discarded.

The existing business-metrics contract describes the MCP counter as dimensioned by server, tool,
OAuth client, and status, while its `allowed_optional_labels` lists only `tenant_id` and
`workspace_id`. The runtime descriptor adds `server`, `tool_name`, `oauth_client`, and
`status_class`. Exporting the descriptor without first making that policy explicit would turn an
existing documentation inconsistency into a public scrape-contract inconsistency.

## Goals

- Export exactly the two families already backed by real MCP tool invocations.
- Account successful, failed, and observable denied outcomes exactly once at one shared seam.
- Keep telemetry best-effort and incapable of changing a tool result.
- Make the emitted label set explicit, bounded, non-PII, and tied to verified/canonical sources.
- Produce correct Prometheus counter and histogram exposition with truthful empty/reset behavior.
- Preserve every legacy family and the current `/metrics` trust and routing boundary.
- Provide local unit, public black-box, contract, format, and documentation evidence without a
  deployment or cluster.

## Non-Goals

- Exporting any other business, normalized component, probe, or collection-health family.
- Generating zero, placeholder, inferred, audit-derived, HTTP-derived, back-filled, or synthetic
  metrics.
- Changing the public `/v1/metrics/*` API, OpenAPI, clients, console, dashboards, alerts, quota,
  billing, or domain-audit behavior.
- Adding a generic telemetry SDK, OpenTelemetry collector, Pushgateway, remote write, persistent
  registry, or cross-process aggregation.
- Changing APISIX/gateway configuration, endpoint authentication, scrape discovery, network
  policy, deployments, Helm, or Kubernetes.
- Mirroring MCP families from the executor into the separate control-plane process.

## Decision 1: Define one canonical completed-invocation boundary

An in-scope MCP tool invocation begins only after all of the following are true:

1. the request has a credential-verified tenant identity;
2. the server resolves within that tenant and has an active published version;
3. the requested tool resolves to a canonical tool in that active manifest; and
4. the engine enters the tool's scope/dispatch decision.

It completes when that decision returns a successful tool result, an error result, or a tool-level
scope denial. Latency covers this bounded invocation segment through the completed result. This
definition deliberately excludes unauthenticated requests, foreign/unknown servers, inactive
servers, missing tool names, unknown tool names, malformed non-call JSON-RPC messages, and other
failures before canonical tool attribution. It also excludes a hard rejection, such as a rate
limit, if it occurs before the canonical invocation boundary. Such requests may retain normal HTTP
and audit behavior, but they are not fabricated as real tool executions.

`invokeTool(...)` returns an internal envelope containing the existing caller-visible `result` and
an `outcomeClass`. The completion path passes only that internal class to telemetry shaping; it
never infers the class from `isError`, response text, result content, or audit detail. The complete
classification matrix is:

| Concrete path after server/version resolution | `outcomeClass` | Accounting |
| --- | --- | --- |
| Requested name is absent from the active published manifest | none | pre-attribution; no pair |
| Canonical tool, caller lacks `BASE_SCOPE` | `denied` | one pair |
| Canonical mutating tool declares a scope, caller lacks that scope | `denied` | one pair |
| Canonical mutating tool declares neither `scope` nor `suggestedScope` | `error` | one pair |
| Canonical tool fails argument/call-shape validation | `error` | one pair |
| Canonical backend returns an HTTP status outside 200-299 | `error` | one pair |
| Canonical backend fetch is unavailable/throws | `error` | one pair |
| Canonical backend returns HTTP 200-299 | `success` | one pair |

An unknown requested name returns `{ result, outcomeClass: null }`; all completed canonical paths
return exactly one of the three enum values. This makes every current `invokeTool` return path
explicit and lets observable authorization denials produce `denied` without text parsing.

Both entry surfaces continue to converge on `executeMcp({ operation: "call_tool" })`. The sink is
called only there, never again in the JSON-RPC wrapper or HTTP server. This provides one accounting
point and prevents transport-dependent double counting.

## Decision 2: Submit one validated counter/histogram pair to an optional sink

`createMcpEngine` receives an optional metrics sink through its existing dependency-injection
options. After a completed invocation, the engine creates the two descriptors and submits them in
one synchronous `recordMcpToolCallPair({ counter, histogram })` call. The sink has no separately
callable counter or histogram mutation and is not a general dynamic metric-registration API; it
does not accept a request-supplied metric name or label key.

The registry stores each MCP label tuple as one combined entry containing the counter value and
the histogram buckets/sum/count. The pair operation validates names, kinds, exact label keys,
fixed/enumerated values, verified scope shape, and finite latency before reading published state.
It then clones the current combined entry and calculates both next halves in detached local data.
The only publication is one final `Map.set(tuple, nextCombinedEntry)` after all fallible work has
completed; nothing fallible runs after that commit. Therefore any validation, cloning, or
calculation exception leaves the combined MCP aggregate and its counter/histogram family blocks
byte-for-byte unchanged, while a successful commit makes both halves visible together. Tests
compare only those MCP blocks, not the independently time-varying process-uptime sample.

The engine catches a shaping or sink error, performs no automatic retry, and returns the original
tool or JSON-RPC outcome. Avoiding retries prevents an ambiguous external sink failure from
becoming a duplicate; the built-in registry has no ambiguous partial-commit state.

This yields the following precise guarantee:

- each in-scope completed invocation causes exactly one sink submission;
- a functioning sink records exactly one counter/histogram pair;
- an absent or failing sink may create an observability gap, because telemetry is best-effort, but
  it cannot partially mutate the pair, duplicate it, or fail the tool call; and
- the existing structured audit detail remains independent of metrics success.

The runtime composition passes the executor registry sink to the MCP engine when MCP is enabled.
Unit tests may inject a spy or throwing sink. The engine remains usable without a sink.

## Decision 3: Make the MCP label contract exact and safely attributable

The business-metrics manifest remains the authority for the MCP counter. Its
`mcp_tool_invocations_total` entry changes in four exact ways:

- `supported_scopes` becomes exactly `tenant` and `workspace`; this producer never emits
  `platform` because every hosted MCP call requires credential-verified tenant identity;
- `tenant_id`, `server`, `tool_name`, and `status_class` become required family labels in addition
  to the existing base/business labels;
- `workspace_id` remains conditional (required exactly for workspace scope) and `oauth_client`
  remains optional (present only for a verified non-secret client id); and
- a validator-enforced family policy fixes the business values, constrains `status_class` to
  `success|error|denied`, and records the canonical source/omission rule for each attribution
  label. If the generic validator currently requires tenant/workspace identifiers to appear in
  `allowed_optional_labels`, it is tightened to accept a scope identifier as either required or
  conditional instead of misclassifying always-required `tenant_id` as optional.

The normalized histogram retains its global metrics-stack required labels. Its
`component_operation_duration_seconds` entry gains a validator-enforced slice rule whose match is
exactly `{ subsystem: "mcp", operation: "tool_call" }`. That slice alone allows the MCP
attribution/outcome labels, requires `tenant_id`, `server`, `tool_name`, and `status_class`, makes
`workspace_id` conditional on workspace scope, makes `oauth_client` conditional on verified client
identity, limits scope to tenant/workspace, and limits status to the three-value enum. This is not
an addition to the normalized family's generic optional labels and grants nothing to another
subsystem/operation match.

The exact emitted label policy is:

| Label | Counter | MCP histogram slice | Value/source and safety rule |
| --- | --- | --- | --- |
| `environment` | required | required | bounded runtime configuration, never request input |
| `subsystem` | required, fixed `mcp` | required, fixed `mcp` | static |
| `metric_scope` | required | required | only `workspace` or `tenant` from verified scope; never `platform` or caller selected |
| `collection_mode` | required, fixed `push` | required, fixed `push` | static |
| `tenant_id` | required | required | credential-verified tenant |
| `workspace_id` | workspace only | workspace only | workspace on tenant-resolved server; required iff scope is workspace, otherwise absent |
| `server` | required | required | canonical id returned by tenant-scoped registry resolution; no raw URL/path/probe |
| `tool_name` | required | required | canonical name in active published manifest; unknown names create no series |
| `oauth_client` | optional | optional | verified non-secret client id; absent if unavailable, never token/secret/raw claim |
| `status_class` | required | required | internal `outcomeClass`, exactly `success`, `error`, or `denied` |
| `domain` | required, fixed `mcp_tool_usage` | forbidden | counter-only business dimension |
| `metric_type` | required, fixed `usage` | forbidden | counter-only business dimension |
| `feature_area` | required, fixed `mcp` | forbidden | counter-only business dimension |
| `operation_family` | required, fixed `execute` | forbidden | counter-only business dimension |
| `operation` | forbidden | required, fixed `tool_call` | histogram-slice discriminator |

For an emitted real invocation, `tenant_id`, `server`, `tool_name`, and `status_class` are present.
`oauth_client` is present only when credential verification produced a non-secret client
identifier; no generic `system`, raw subject, or client-supplied fallback is invented. Identifier
values come only from existing tenant-scoped MCP server, published-tool, and OAuth client
inventories rather than arbitrary request strings. This permission is local to the two named MCP
outputs and is not a generic assertion that any inventory-backed string is safe on another family.
Labels are not derived from arguments or returned data.

The exact label-key allowlist excludes `user_id`, `request_id`, `session_id`, `email`,
`api_key_id`, `authorization_header`, `raw_path`, `raw_query`, `object_key`, `workspace_slug`,
`tenant_slug`, raw arguments, error messages, result content, tokens, and secrets. Contract and
runtime tests compare the manifest policy with emitted descriptors so a later drift fails
deterministically.

This explicit contract update is preferred over silently dropping all server/tool/client labels:
those canonical dimensions are already part of the family's declared purpose and downstream
per-client governance model. Allowing arbitrary values was rejected; the manifest update permits
only canonical bounded inventories and the fixed outcome enum.

## Decision 4: Extend only the executor's fixed registry

The executor registry adds one combined MCP map keyed by a deterministic tuple of the exact slice
labels. Its single pair-recording function rejects unexpected metric names, kinds, label keys,
fixed values, status values, non-finite latency, platform scope, or invalid tenant/workspace
combinations before cloning or publishing state.

Each combined entry stores the counter and the latency histogram's cumulative bucket counts, sum
in seconds, and count, so one `Map.set` publishes both updates. The histogram reuses the
metrics-stack bucket vector exactly:

`0.005`, `0.01`, `0.025`, `0.05`, `0.1`, `0.25`, `0.5`, `1`, `2.5`, `5`, `10`, plus the
required `+Inf` bucket.

The separate control-plane registry is not fed executor MCP events. Duplicating the series there
would either require cross-process transport or manufacture an empty/zero family without a local
producer, both outside this change.

## Decision 5: Render deterministic Prometheus text without fake samples

`renderMetrics()` emits one static `# HELP` and one static `# TYPE` declaration for each new family
in a deterministic block. The invocation family is declared `counter`; the duration family is
declared `histogram`. A histogram series renders cumulative `_bucket` samples for every finite
boundary and `le="+Inf"`, followed by `_sum` and `_count`; `+Inf` equals `_count`.

Label values use Prometheus text-format escaping for backslash, double quote, and line breaks.
Metric names, label names, and HELP text are static, not escaped user input. Observations must be
finite, non-negative seconds. Stable label ordering is used for deterministic tests, though
Prometheus identity does not depend on textual label order.

Before a label tuple has real activity, no counter, bucket, sum, or count sample line is emitted for
it. Static HELP/TYPE metadata may be emitted in an otherwise empty family block; metadata is not a
zero series. No catalog family other than the two selected families receives metadata or samples
under this change.

The complete document retains `text/plain; version=0.0.4; charset=utf-8` and a terminating newline.
It remains parseable as one exposition document and retains all legacy blocks. The existing five
legacy sample names remain:

- `falcone_http_requests_total`;
- `falcone_http_request_duration_seconds_bucket`;
- `falcone_http_request_duration_seconds_sum`;
- `falcone_http_request_duration_seconds_count`; and
- `falcone_process_uptime_seconds`.

Their recorder behavior, labels, HELP/TYPE declarations, and values do not change.

## Decision 6: Preserve the existing trust boundary

The exact executor `GET /metrics` and `/metrics/` handling, listener, method behavior, content type,
and current authentication/network controls do not change. There is no new tenant-facing metrics
route. Existing scrape authorization determines who may read all series; this change does not
claim that the scrape document is filtered per caller.

P13 protection has two parts:

1. a tenant-B MCP identity cannot resolve tenant A's server or cause a tenant-A/workspace-A label,
   because attribution follows credential verification and tenant-scoped registry resolution; and
2. an actor outside the current internal scrape boundary receives no new route, port, listener,
   gateway mapping, or credential path.

No client-controlled tenant/workspace/message hint is trusted. A caller that is already inside the
current scrape boundary retains the same process-wide visibility model; changing that model would
be a separate security change and would conflict with the required boundary preservation.

## Decision 7: Treat restart as reset, not history

The two new aggregates are process memory only. A fresh process has no sample tuples until real
post-start activity occurs. Counter and histogram values are monotonic within one process lifetime
and reset on restart. Prometheus `rate()`/`increase()` handles the reset; the runtime does not
persist, replay audit records, backfill, copy a previous value, or emit a zero placeholder.

Operator documentation distinguishes these expected states:

- MCP is disabled, so no producer exists;
- MCP is enabled but no canonical tool invocation has completed in this process lifetime;
- the scraper is targeting the separate control-plane process rather than the executor;
- the executor restarted and is warming from an empty registry; or
- telemetry validation/recording failed and the tool operation continued under best-effort
  semantics.

## Decision 8: Validate through local public and internal seams

The evidence chain contains:

- registry unit tests for exact aggregation, escaping, bucket cumulative behavior, empty state,
  pair atomicity, invalid labels, and legacy compatibility;
- engine unit tests with injected spy/throwing sinks for success, error, observable denial,
  pre-attribution rejection, exactly-once submission, and best-effort behavior;
- public black-box tests that start the real executor HTTP server on ephemeral loopback ports,
  exercise management and JSON-RPC calls through their HTTP surfaces, scrape `/metrics`, and test
  P13 scope spoofing/foreign-server controls;
- contract tests proving the business-metrics allowlist/outcome enum and metrics-stack buckets align
  with the runtime descriptors;
- a Prometheus text parser or `promtool check metrics` when available, with a deterministic parser
  fallback suitable for CI;
- the existing metrics, MCP, observability-contract, and documentation checks; and
- strict OpenSpec validation.

Tests use in-memory/temp fixtures, ephemeral ports, and loopback only. They do not require Docker,
external network access, a shared service, or Kubernetes.

## Alternatives Considered

- **Export the whole catalog:** rejected because the other families have no verified runtime
  producers; emitting them would create false evidence.
- **Mirror or aggregate in the control-plane process:** rejected because it would require a new
  transport/state design and could double count.
- **Add a dedicated authenticated MCP metrics endpoint:** rejected because C07 is an export-wiring
  defect on the existing scrape surface and the trust boundary must remain unchanged.
- **Use audit records or logs as the counter source:** rejected because it couples independent
  planes, creates replay/deduplication semantics, and is not the existing real-time producer.
- **Silently drop server/tool/client dimensions:** rejected because the family contract already
  declares those dimensions as meaningful; an exact canonical allowlist resolves the conflict more
  honestly.
- **Retry telemetry writes:** rejected because in-process writes need no retry when healthy and a
  retry after an ambiguous failure risks double counting.

## Rollback

Rollback removes the engine sink injection/composition and the two executor registry aggregates and
render blocks, then reverts the matching contract clarification, focused tests, and documentation.
It does not alter or clean a datastore because no metric state is persisted. The existing
`falcone_*` output, `/metrics` route, and scrape boundary remain intact throughout. Rollback
reintroduces the confirmed absence of C07 signals and must not substitute synthetic zeros.
