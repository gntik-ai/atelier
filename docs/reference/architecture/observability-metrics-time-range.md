# Observability Metrics Time Range

This reference is for workspace owners and administrators, workspace operators, scoped
viewers/auditors, API consumers, and operators diagnosing the workspace Observability Metrics
chart. The workspace series is a read-only view of HTTP request telemetry. It does not create a
domain audit event, write metric or application data, consume quota, or change a rate-limit
policy.

Status: the bounded workspace contract described here supports request and server-error rates.
Storage, business, component, custom date-range, and raw PromQL series are not supported by this
operation. Local validation was defined on 2026-07-28 from the canonical OpenAPI and the OpenSpec
change `fix-c04-workspace-metric-series`. A later-authorized disposable kind regression also
validated the real console, control-plane, Prometheus, identity, and workspace-isolation path; its
public APISIX routing limitation is recorded below.

## Scope and permissions

The route keeps its existing authentication, workspace lookup, and authorization behavior.
Workspace owners/administrators, operators, and read-only viewers receive the series only when
their existing role is permitted to read that workspace. Service identities gain no new grant.
An unknown workspace returns the existing `404 WORKSPACE_NOT_FOUND`; a known workspace owned by
another tenant returns the existing `403 FORBIDDEN`. Neither outcome reaches Prometheus or exposes
metric labels, query text, points, counts, or provider detail.

The backend resolves the workspace through the canonical workspace store and constructs exact
Prometheus matchers for both its owning `tenant_id` and canonical `workspace_id`. Query, body, and
header values cannot override those labels. Backslash, double quote, and line-break characters in
resolved identifiers are escaped as Prometheus label-string data; they are not removed or
interpreted as selector syntax.

Both the control-plane and executor HTTP counters add `workspace_id` only after their existing
scope checks. The control-plane labels an authenticated and authorized workspace route from the
canonical workspace and its owning tenant, not from the token tenant or a workspace claim alone,
and retains that scope for `4xx`/`5xx` outcomes; the executor uses its existing trusted
credential/ownership boundary. Platform, tenant-only, anonymous, health, unmatched, foreign,
unknown, and otherwise unscoped samples omit the workspace label instead of emitting an empty,
raw-path, or client-supplied value.

## Public workspace series contract

The workspace route requires exactly one `metricKey` and exactly one `window`:

```http
GET /v1/metrics/workspaces/{workspaceId}/series?metricKey=api_requests&window=7d
```

Supported metric keys are:

| `metricKey` | Meaning | Source |
| --- | --- | --- |
| `api_requests` | Per-second rate of all matching HTTP requests | `falcone_http_requests_total` |
| `api_errors` | Per-second rate of matching requests with `5xx` status | `falcone_http_requests_total` |

The metric name, five-minute rate lookback, tenant/workspace labels, error-status matcher, range,
and step all come from server-owned allowlists. Clients cannot supply a metric family, label
selector, PromQL expression, start, end, or step. Missing, empty, repeated, malformed, or
unsupported key/window values return HTTP `400` before provider access. This includes
`storage_bytes`, the legacy `http_requests_per_second` key, and PromQL-like input.

Every window maps to an exact range and bounded step:

| `window` | Range seconds | Prometheus step seconds | Maximum intervals |
| --- | ---: | ---: | ---: |
| `5m` | 300 | 5 | 60 |
| `1h` | 3,600 | 15 | 240 |
| `24h` | 86,400 | 300 | 288 |
| `7d` | 604,800 | 1,800 | 336 |
| `30d` | 2,592,000 | 7,200 | 360 |

The server captures one integer Unix `end` timestamp, subtracts the table's exact range to obtain
`start`, and supplies the fixed step. It does not default, clamp, or reinterpret unsupported
values.

A successful response, including an empty degradation response, uses the closed
`MetricSeriesResponse` shape:

```json
{
  "tenantId": "ten_example",
  "workspaceId": "wrk_example",
  "metricKey": "api_requests",
  "window": "7d",
  "unit": "requests_per_second",
  "points": [
    {
      "timestamp": "2026-07-28T00:00:00.000Z",
      "value": 2.5
    }
  ]
}
```

Points contain only real, finite Prometheus samples converted to RFC 3339 timestamps, in provider
order. The service does not fabricate zeroes, interpolate gaps, or add a `source` field.

## Console behavior

At tenant scope, the Metrics tab reads:

- `GET /v1/metrics/tenants/{tenantId}/overview`
- `GET /v1/metrics/tenants/{tenantId}/usage`

Those tenant routes return the current tenant quota/usage overview and do not accept a `window`
query parameter. When no workspace is selected, the console therefore labels the time-range selector
as non-applicable and disables it instead of presenting an active control that would refetch the same
tenant data.

At workspace scope, the Metrics tab also reads the workspace series route with
`metricKey=api_requests`. The console keeps the selector active and maps its existing presets to
`24h`, `7d`, and `30d`. API clients may also use the published `5m` and `1h` windows. Custom
from/to ranges and a metric picker are not exposed by the console.

## Warm-up, degradation, and troubleshooting

Workspace labeling is additive. Samples emitted before the producer change have no
`workspace_id` and are intentionally excluded. During rollout and the Prometheus rate lookback,
workspace series can therefore be empty or partial until new labeled samples accumulate. The
reader never falls back to tenant-only history because that would attribute sibling-workspace
traffic to the selected workspace.

Prometheus timeout/unreachability, a non-success response, invalid JSON, an unsuccessful payload,
a missing result, or unusable samples returns HTTP `200` with the resolved identifiers, accepted
key/window, and `points: []`. The response exposes no provider URL, query, payload, exception, or
other internal detail. An empty result can therefore mean either no matching traffic yet or
temporary provider degradation; check the platform's existing internal collection health and
request telemetry when diagnosis is required.

No datastore migration or historical backfill is needed. Producer and reader changes should ship
together. Rollback reverts the handler, producers, contract, and this reference; already stored
workspace-labeled samples require no cleanup and expire under normal Prometheus retention. A
rollback reintroduces tenant-only workspace reads and must not be used to merge legacy samples
into the corrected series.

## Focused local validation

From the repository root, run:

```bash
node --test tests/unit/workspace-metric-series.test.mjs
node --test tests/unit/metrics-registry.test.mjs
node --test tests/unit/metrics-runtime-workspace-propagation.test.mjs
node --test tests/contracts/workspace-metric-series.contract.test.mjs
pnpm --dir apps/web-console exec vitest run src/lib/console-metrics.test.ts
npm run validate:openapi
npm run validate:public-api
openspec validate fix-c04-workspace-metric-series --strict
```

These checks are hermetic and do not require Prometheus, Docker, credentials, a browser,
Kubernetes, or an external provider.

## Disposable kind regression

The real-stack regression lives in
`tests/e2e/specs/issues/fix-c04-workspace-metric-series.spec.ts`, with its non-secret deployment
profile in `tests/e2e/values-c04-workspace-metric-series.yaml`. After preparing a dedicated local
kind kubeconfig, chart 0.3.1, the three remediation images named by the profile, and ephemeral
console credentials, run:

```bash
bash tests/e2e/run-issue.sh fix-c04-workspace-metric-series
```

The issue runner selects the C-04 values and ephemeral namespaces. It verifies invalid inputs stop
before Prometheus, sibling workspaces produce isolated labeled samples and distinct series, a
foreign-tenant caller remains denied without provider access, and the real console accepts an
authoritative empty series. It waits for workloads in both the application and auxiliary
ESO/OpenBao namespaces and deletes both namespaces on exit; Playwright reports, kubeconfigs,
credentials, and raw run evidence are not tracked.

Chart 0.3.1 starts APISIX in standalone mode without mounting its generated standalone route
table. The C-04 profile therefore points the console's same-origin edge directly at the tested
control-plane service. This regression proves `console → control-plane → Prometheus`; it does not
prove `public ingress → APISIX → control-plane`, and the independent chart packaging defect must
be validated separately.
