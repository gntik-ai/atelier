# Change: Fix workspace metric-series selection and scope

## Why

C-04 / OBS-CONTRACT-04 is a confirmed workspace observability contract defect. On baseline
`67322ae9`, requests for `api_requests` over `24h` in `wrk_alpha` and `storage_bytes` over `7d` in
`wrk_beta` produce the same tenant-only PromQL, fixed one-hour range, and
`metricKey: http_requests_per_second`. The response omits `tenantId`, `workspaceId`, and `window`,
adds the undeclared `source` property, and accepts missing required parameters with HTTP `200`.

The root cause is bounded to the workspace series path and its existing HTTP metric producer.
`apps/control-plane/metrics-handlers.mjs` reads `query.metric` instead of the public
`metricKey`, hardcodes a 3600-second query with step 60, and selects only `tenant_id`. The
control-plane and executor HTTP counters record `tenant_id` but not `workspace_id`, so the
workspace route has no workspace-specific samples to select.

Workspace owners/administrators (P7), workspace operators/application DevOps users (P9), and
scoped viewers/auditors (P10) need a truthful, read-only series for the selected workspace, metric,
and window. Existing constrained-role authorization remains unchanged by this finding. Platform
operators (P3) and security/compliance auditors (P4) are adjacent operational and read-only
controls; service workloads (P12) remain subject to their existing grants; and an actor from
another tenant (P13) is the adversarial isolation control.

## What Changes

- Restrict the public workspace series operation to the closed metric-key allowlist
  `api_requests` and `api_errors`, both backed by the existing
  `falcone_http_requests_total` counter.
- Define `api_requests` as the per-second rate of all matching requests and `api_errors` as the
  per-second rate of matching requests with a `5xx` status.
- Reject missing, empty, repeated/ambiguous, or unsupported `metricKey` and `window` values with a
  stable HTTP `400`. In particular, reject `storage_bytes` rather than fabricating unavailable
  storage history. The separate C-02 `ErrorResponse` defect is not changed.
- Map `5m`, `1h`, `24h`, `7d`, and `30d` to exact ranges and bounded Prometheus steps, rather than
  using a fixed one-hour query.
- Resolve the workspace through the existing lookup and authorization boundary, and select
  Prometheus samples by both its resolved `tenant_id` and `workspace_id`. Escape label values for
  PromQL; never accept raw metric names, label selectors, or PromQL from the request.
- Add `workspace_id` to HTTP request counter samples emitted by both control-plane and executor
  runtimes when a trusted or resolved workspace is available. Keep anonymous, platform, and
  tenant-only samples compatible by omitting the workspace label when no trusted workspace exists.
- Make every successful workspace series response, including Prometheus unavailable,
  non-successful, malformed, or unreachable degradation, conform to `MetricSeriesResponse` with
  `tenantId`, `workspaceId`, `metricKey`, `window`, and `points`, plus optional `unit`; remove the
  undeclared `source` property.
- Preserve the console request behavior: it continues to send `api_requests` and the selected
  supported preset window and consumes the returned points without a UX redesign.
- Preserve GET/read-only semantics, current authentication and authorization, the existing distinct
  foreign-workspace `403` and unknown-workspace `404` outcomes, normal request telemetry, and the
  absence of a domain audit event or quota mutation.
- Add focused handler, metric-registry, OpenAPI/response-contract, console-client, isolation, and
  degradation tests, and update the existing workspace metric time-range reference.

## Personas and Observable Outcomes

- P7 and P9 receive request or `5xx` request-rate points selected for the resolved workspace and
  requested window when their existing authorization permits the read.
- P10 remains read-only and receives the same truthful scoped response when already authorized;
  this change adds no mutation affordance and does not expand a constrained role.
- P3 and P4 remain adjacent operational/read-only controls under their current authorization.
  This change does not reconcile the separate role-mapping candidates found by the audit.
- P12 gains no new grant or credential path. If its existing authorization denies the operation,
  the denial remains unchanged.
- P13 cannot substitute a foreign workspace ID, tenant label, workspace label, metric name,
  selector, or PromQL to read another scope. A known foreign workspace retains the existing `403`
  authorization outcome, an unknown workspace retains the existing `404` lookup outcome, and
  neither reaches Prometheus.
- When Prometheus cannot provide data, every authorized caller receives an empty, correctly
  identified series rather than fabricated points or a schema-invalid success body.

## Non-Goals

- No C-07 storage, business, normalized, component, MCP, Kafka, gateway, function, or other metric
  family. `storage_bytes` remains unsupported by this operation.
- No C-01 repair for other metrics success schemas and no C-02 global `ErrorResponse` repair.
- No authentication, role mapping, permission, workspace membership, superadmin, or gateway policy
  expansion.
- No tenant-series behavior change and no new public route, SDK operation, custom date range, raw
  metric selector, raw label selector, or raw PromQL input.
- No metric datastore, retention, recording rule, scrape, dashboard, chart, alert, tracing,
  domain-audit, quota, or billing redesign.
- No console page, interaction, copy, accessibility, or visual redesign; rendered-UI persona P16
  is not an implementation surface for this remediation.
- No data migration or backfill of legacy samples that lack `workspace_id`.
- No cluster deployment, Docker/Playwright/live verification, credentials, evidence capture,
  loop-state change, Helm/chart change, or Kubernetes access.
- No remediation of any audit finding other than C-04.

## Exit Criteria

- `metricKey=api_requests` selects the all-status request-rate query, and
  `metricKey=api_errors` selects only the `5xx` request-rate query.
- `5m`, `1h`, `24h`, `7d`, and `30d` select their exact range durations and documented bounded
  steps; no supported window silently becomes one hour.
- The workspace query contains exact matchers for both the resolved `tenant_id` and
  `workspace_id`, with escaped values, and contains no request-supplied metric or PromQL fragment.
- Two sibling workspaces in one tenant generate distinct selectors and cannot receive each
  other's labeled samples. Same-tenant and cross-tenant authorization controls remain stable.
- Missing, empty, repeated/ambiguous, or invalid `metricKey` or `window`, including
  `storage_bytes`, returns stable HTTP `400` without querying Prometheus.
- Both HTTP metric producers attach `workspace_id` only from trusted/resolved workspace context
  and retain compatible series without that label for platform, tenant-only, anonymous, and
  otherwise unscoped requests.
- Every HTTP `200` validates against `MetricSeriesResponse`, echoes the resolved tenant/workspace
  and accepted key/window, contains no `source` property, and includes only real Prometheus points
  or an empty `points` array.
- Prometheus unavailability, non-success, invalid response, or reachability failure degrades to an
  empty conforming series with no fabricated values or provider detail.
- The existing console still requests `api_requests` with its selected `24h`, `7d`, or `30d`
  window and consumes the response without a UX/API behavior change.
- The GET emits normal HTTP request metrics but no domain audit event, data write, quota
  consumption, or quota-policy change.
- Focused backend, registry, contract, console-client, isolation, degradation, and documentation
  checks pass.
- `openspec validate fix-c04-workspace-metric-series --strict` passes.
- Live and cluster verification are explicitly recorded as not run by request.

## Risks and Rollback

Adding `workspace_id` creates a telemetry warm-up boundary. Samples emitted before rollout do not
have that label and are intentionally excluded from workspace queries; the API may therefore
return an empty or partial series until newly labeled samples accumulate. The implementation must
not fall back to tenant-only history, because doing so would misattribute sibling-workspace traffic.

The main isolation risk is deriving a metric label from an untrusted header, raw path value, or
caller-provided PromQL. Trusted workspace resolution, exact label matchers, PromQL escaping, a
closed key/window map, sibling-workspace tests, and cross-tenant controls bound that risk. The main
operational risk is unbounded point count across long windows; fixed steps cap the requested
resolution.

Rollback is a revert of the code, OpenAPI/docs, and focused tests for this change. It requires no
data or datastore migration. Existing samples with `workspace_id` can remain in Prometheus and are
ignored by older tenant-only queries. Rollback reintroduces the C-04 behavior and should not be
used as a fallback that merges legacy tenant-only samples into workspace results.
