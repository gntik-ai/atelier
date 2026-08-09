# Change: Export real MCP business metrics on the existing scrape endpoint

## Why

C07 is a confirmed observability defect. The executor process's existing `GET /metrics` scrape
surface exposes the five legacy `falcone_*` HTTP/process sample families and no `in_falcone_*`
series. The product nevertheless already shapes two signals for every completed MCP tool call:

- `in_falcone_mcp_tool_invocations_total`, a business-usage counter; and
- `in_falcone_component_operation_duration_seconds`, the normalized component-latency histogram
  with `subsystem="mcp"` and `operation="tool_call"`.

`mcpToolCallTelemetry` creates both descriptors, but the `call_tool` path retains only the
structured log in its audit detail and discards `telemetry.metric` and `telemetry.latency`.
`runtime/metrics-registry.mjs` also has no recorder or renderer for either descriptor. The
contract therefore advertises MCP usage and latency that the process never exposes to Prometheus.

Platform superadministrators (P1), platform operators/SREs (P3), security/compliance auditors
(P4), workspace owners/administrators (P7), workspace operators/application DevOps users (P9),
and scoped viewers/auditors (P10) need truthful MCP usage and latency under their existing
observability access. MCP OAuth clients and AI/service workloads (P12) are the activity producers,
not new scrape consumers. A valid actor from another tenant (P13) is the isolation and disclosure
control. Documentation maintainers and operators (P17) need a precise production,
troubleshooting, reset, and rollback contract.

## What Changes

- Add one optional, synchronous metrics sink at the executor MCP engine's shared `call_tool` seam.
  Both the management operation and JSON-RPC `tools/call` already converge there.
- Submit one counter increment and one latency observation for every real, completed invocation of
  a canonically resolved tool. Account successful results, tool-error results, and tool-level
  scope denials that are observable after canonical tool resolution. Do not turn authentication,
  foreign/unknown-server, inactive-server, missing/unknown-tool, or other pre-attribution
  rejections into fabricated tool invocations.
- Make `invokeTool` return its caller-visible result together with an internal `outcomeClass`.
  Classify missing base or declared mutating-tool scope as `denied`, invalid call shape and
  backend responses outside HTTP 200-299 as `error`, HTTP 200-299 responses as `success`, and an
  unknown requested tool as pre-attribution with no metric. Never parse result/error text to
  classify telemetry.
- Record the counter and histogram observation through one pair-only sink operation. Validate and
  calculate a detached combined next state before one final publication, so any pre-commit failure
  leaves both MCP aggregates and their two rendered family blocks byte-for-byte unchanged.
  Telemetry remains best-effort, causes no retry, and never changes the tool or JSON-RPC result.
- Render only `in_falcone_mcp_tool_invocations_total` and the MCP slice of
  `in_falcone_component_operation_duration_seconds` through the executor's existing `/metrics`
  endpoint. Use valid Prometheus text exposition, one `HELP`/`TYPE` declaration per family,
  Prometheus label escaping, finite values, and the contractual latency buckets.
- Reconcile the two exact label contracts without granting generic cardinality permission. The MCP
  counter supports only verified tenant/workspace scope and requires `tenant_id`, canonical
  `server`, canonical `tool_name`, and bounded `status_class`; `workspace_id` is conditional on
  workspace scope and `oauth_client` is conditional on a verified non-secret client id. Add the
  same rule as an explicit, validator-enforced `subsystem="mcp"`/`operation="tool_call"` slice on
  the normalized histogram, with no change to other subsystem/operation slices. Neither family
  emits `metric_scope="platform"`.
- Preserve the current five `falcone_*` sample families, `/metrics` path, content type, scrape
  authentication/network boundary, and process-local registry model. The separate control-plane
  process does not mirror executor MCP activity or emit synthetic MCP series.
- Keep the empty state truthful. `HELP`/`TYPE` metadata may be present, but no counter or histogram
  sample exists before a real invocation for that label set. A process restart clears the
  in-memory MCP series and is handled as a normal Prometheus counter reset; there is no backfill.
- Add focused unit tests, public HTTP black-box tests on ephemeral loopback ports, contract tests,
  Prometheus-format validation, and operator documentation. All validation is local/hermetic; no
  cluster is used.

## Personas and Observable Outcomes

- **P1/P3:** under the existing scrape and observability boundary, can determine actual MCP
  invocation volume, outcome class, and latency without consulting audit records as a metric
  substitute.
- **P4:** can verify that the emitted family and labels match the declared contract and carry no
  PII, secret, raw argument, or caller-selected scope.
- **P7/P9:** their authorized workspace activity is attributed to the verified tenant and resolved
  workspace; this change adds no metrics API or new read grant.
- **P10:** remains constrained and read-only. The corrected signals are visible only through access
  already granted to the existing metrics/observability plane.
- **P12:** a credential-verified OAuth client or AI/service workload produces one attributable
  signal pair per real tool invocation; its token, secret, raw claims, arguments, and result are
  never metric labels.
- **P13:** cannot select a foreign tenant/workspace label, create series for a foreign server, turn
  an arbitrary tool string into unbounded cardinality, or gain a new route/listener. An actor
  outside the current scrape trust boundary remains outside it.
- **P17:** receives exact family, label, empty-state, restart, verification, troubleshooting, and
  rollback guidance.

## Non-Goals

- No synthetic, pre-seeded, zero-valued, back-filled, or inferred series.
- No implementation of the other cataloged tenant/workspace lifecycle, API, identity, function,
  data-service, storage, realtime, quota, component availability/error/probe, collection-health,
  or collection-lag families. They remain absent until a separate change wires a real producer.
- No use of audit-record counts, HTTP request counts, quotas, logs, or static catalog entries as a
  proxy producer for an unimplemented family.
- No UI, dashboard, alert, OpenAPI, generated client, public REST `/v1/metrics/*`, quota, billing,
  audit-event, or console behavior change.
- No gateway/APISIX, new path, listener, port, Service, Ingress, authentication, authorization,
  role, network-policy, scrape-target, deployment, Helm, or Kubernetes/cluster change.
- No mirrored MCP metrics in the separate control-plane registry, cross-process aggregation,
  persistence, remote-write, collector, Pushgateway, datastore, migration, historical replay, or
  backfill.
- No remediation of C04 workspace series, C06 APISIX scraping, or any audit finding other than C07.

## Exit Criteria

- One successful invocation produces exactly one counter increment with `status_class="success"`
  and one latency observation for the same verified scope and canonical MCP dimensions.
- `invokeTool` returns an internal `outcomeClass` beside the result: missing `BASE_SCOPE` or a
  caller missing the canonical mutating tool's declared scope maps to `denied`; a mutating tool
  with no declared scope, call-shape validation, backend response outside HTTP 200-299, or
  unavailable backend maps to `error`; an HTTP 200-299 response maps to `success`. An unknown
  requested tool has no outcome class and creates no pair. No classification parses caller-visible
  text.
- Management `call_tool` and JSON-RPC `tools/call` use the same accounting seam and do not double
  count.
- The registry exposes one pair-only mutation. It validates/clones/calculates both next aggregates
  before one commit; a forced pre-commit failure leaves the caller-visible result unchanged,
  performs no retry, and leaves the combined MCP aggregate plus both MCP family blocks byte-for-byte
  unchanged.
- Both families require verified `tenant_id`, canonical `server`, canonical `tool_name`, and
  internal `status_class`; `workspace_id` is present exactly for workspace scope and
  `oauth_client` only for a verified non-secret client id. Scope is exactly tenant/workspace, never
  platform, and status is exactly `success`, `error`, or `denied`.
- The business-metrics manifest and its deterministic validation explicitly permit and constrain
  the runtime descriptor; no undeclared label is exported and no PII, secret, raw request, raw
  tool argument, error text, or result content becomes a label.
- `/metrics` is valid Prometheus text with the unchanged content type, correctly escaped label
  strings, a counter declaration, and cumulative histogram buckets at `0.005`, `0.01`, `0.025`,
  `0.05`, `0.1`, `0.25`, `0.5`, `1`, `2.5`, `5`, `10`, and `+Inf`, followed by `_sum` and `_count`.
- Before activity and after restart there are no fake samples; after the next invocation the
  process begins a fresh, monotonic lifetime and downstream `rate()` can interpret the reset.
- All five legacy `falcone_*` sample families retain their names, labels, values, and meaning; the
  existing scrape route and trust boundary remain unchanged.
- Focused unit, public black-box, contract, documentation, metrics-format, and observability
  validation checks pass locally, and
  `openspec validate fix-c07-business-metric-export --strict` passes without cluster access.

## Risks and Rollback

The principal risk is label cardinality or disclosure. The mitigation is an exact counter policy
plus one explicit MCP tool-call histogram slice: verified tenant/workspace scope, registered
server, active-manifest tool, optional verified non-secret OAuth client identifier, fixed MCP
dimensions, and a three-value status enum. The slice is validator-enforced and grants no optional
labels to another normalized-histogram slice. Platform scope, unknown tool names, raw arguments,
request IDs, tokens, subjects, email addresses, errors, and result data are never labels. The
current internal scrape boundary remains the authority for who may read these identifiers; this
change does not claim to make that endpoint tenant-filtered.

The second risk is telemetry affecting tool availability or partially updating a pair. The sink
has one pair-only operation, computes a detached combined next entry, and makes one final state
publication after all fallible work. The engine invokes it once without retry and contains the
entire metrics path as best-effort. A telemetry failure can cause an observability gap, but cannot
fail or duplicate the business operation or publish only half of the pair.

The signals are process-local. Rollout starts from an empty state and restart resets counters and
histograms; temporary absence or a Prometheus reset is expected and must not be interpreted as
zero historical usage. There is no migration or data cleanup.

Rollback reverts the sink wiring, the two registry record/render blocks, the associated contract
clarification, focused tests, and documentation. It requires no data rollback and leaves the
legacy `falcone_*` exposition and existing `/metrics` boundary intact. Rollback intentionally
reintroduces C07 and must not be replaced by fake zero series.
