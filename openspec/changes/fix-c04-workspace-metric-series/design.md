# Design: Workspace metric-series selection and scope

## Context

The public operation
`GET /v1/metrics/workspaces/{workspaceId}/series?metricKey=...&window=...` declares both query
parameters as required and declares a `MetricSeriesResponse` success body. The current local
control-plane handler instead reads `query.metric`, defaults it, ignores `window`, uses a fixed
one-hour Prometheus range, selects `falcone_http_requests_total` by tenant only, and returns
`{metricKey, points, source}`.

The only existing producer suitable for a bounded C-04 repair is
`falcone_http_requests_total`, emitted by the zero-dependency registries in the control-plane and
executor runtimes. It already has bounded `method`, normalized `route`, `status`, and `tenant_id`
labels. It does not yet carry `workspace_id`. No trustworthy storage-history counter exists, so
pretending that `storage_bytes` is available would absorb C-07 and produce false data.

The console already requests `metricKey=api_requests` and maps its workspace time-range presets to
supported `window` values. The repair therefore belongs in the existing handler, both existing
HTTP metric producers, the public schema constraints, focused tests, and the current time-range
reference. It does not require a new route or console redesign.

## Goals

- Make the requested metric key and window consequential and deterministic.
- Scope every workspace query by the resolved owning tenant and exact workspace.
- Return only schema-valid, truthful series, including empty degradation.
- Add workspace labels without breaking platform, tenant-only, or anonymous HTTP series.
- Preserve current authentication, authorization, lookup, quota, audit, and console behavior.
- Bound Prometheus query resolution and metric-label cardinality.

## Non-Goals

- Producing storage or other C-07 metric families.
- Fixing success schemas for other metrics operations or the shared C-02 error envelope.
- Changing roles, grants, memberships, identity trust, gateway policies, or tenant-series routes.
- Migrating, relabeling, or backfilling Prometheus history.
- Changing Prometheus deployment, retention, recording rules, scraping, dashboards, alerts, Helm,
  or cluster configuration.
- Adding raw metric/label/PromQL input, custom dates, or a general metrics query API.
- Changing the console UI or deploying to a shared, staging, or production cluster. A
  later-authorized disposable kind regression is validation-only.

## Decision 1: Use a closed metric-key map over the existing HTTP counter

The workspace series handler accepts exactly two keys:

| Public `metricKey` | Meaning | PromQL expression |
| --- | --- | --- |
| `api_requests` | All matching HTTP requests per second | `sum(rate(falcone_http_requests_total{tenant_id="<tenant>",workspace_id="<workspace>"}[5m]))` |
| `api_errors` | Matching HTTP requests with `5xx` status per second | `sum(rate(falcone_http_requests_total{tenant_id="<tenant>",workspace_id="<workspace>",status=~"5.."}[5m]))` |

Both series use the existing counter and may return optional unit `requests_per_second`. The
five-minute rate lookback is an implementation-owned constant, not client input. The status
matcher uses the existing string status label and does not broaden `api_errors` to `4xx` responses.

The handler does not interpolate `metricKey` into PromQL. It selects a complete expression from
the closed map only after validation. Missing, empty, repeated/ambiguous, or other values return a
stable HTTP `400` before fetch. `storage_bytes`, legacy `http_requests_per_second`, metric family
names, label fragments, and PromQL expressions are unsupported.

Rejecting unavailable keys is preferable to returning an empty fabricated storage series. Adding
storage production was rejected because it is part of C-07. Accepting a raw PromQL fragment was
rejected because it creates injection, scope-bypass, cardinality, and cost risks.

## Decision 2: Map every public window to an exact range and bounded step

The accepted windows remain those already published by OpenAPI:

| Public `window` | Exact range seconds | Prometheus `step` seconds | Maximum intervals |
| --- | ---: | ---: | ---: |
| `5m` | 300 | 5 | 60 |
| `1h` | 3,600 | 15 | 240 |
| `24h` | 86,400 | 300 | 288 |
| `7d` | 604,800 | 1,800 | 336 |
| `30d` | 2,592,000 | 7,200 | 360 |

For a single captured integer `end` timestamp in Unix seconds, `start` is exactly
`end - rangeSeconds`. `start`, `end`, and `step` are sent to Prometheus query-range without any
client override. This keeps the longest request at no more than 361 inclusive evaluation
timestamps while retaining useful resolution for shorter windows.

Missing, empty, repeated/ambiguous, or unknown windows return the same C-04-specific stable
HTTP `400` class before Prometheus is contacted. The implementation must not default a window or
silently clamp an unsupported value.

## Decision 3: Resolve scope once and query both trusted labels

The existing guarded workspace route remains the authority boundary:

1. resolve the path workspace through the existing workspace store;
2. apply the existing authorization decision to its owning tenant;
3. pass the resolved `tenant_id` and canonical workspace ID to the series handler; and
4. only then build and execute the Prometheus query.

The handler does not use `identity.tenantId` as a substitute for the resolved owner and does not
accept a tenant or workspace label through query parameters, request body, or untrusted headers.
The exact PromQL selector always contains both `tenant_id="<resolved tenant>"` and
`workspace_id="<resolved workspace>"`.

Prometheus label values are escaped according to label-string syntax: backslash, double quote, and
line-break characters cannot terminate or extend a matcher. Removing characters from an ID is not
an acceptable escaping strategy because it can alias two distinct identifiers. The complete
PromQL string is then encoded as a URL query parameter by `URLSearchParams`.

The existing missing-workspace and authorization responses remain unchanged under this change.
Foreign and unknown lookup controls expose no tenant identifier, point, label, count, PromQL, or
provider detail and do not call Prometheus. No role, actor-type mapping, workspace membership, or
superadmin behavior is expanded.

## Decision 4: Add conditional workspace labels in both HTTP metric producers

`recordHttp` in both registries accepts an optional trusted `workspaceId`. The counter key and
rendered label set include `workspace_id` only when a non-empty trusted/resolved workspace exists:

- control-plane request handling derives both labels from the canonical workspace resolved for a
  matched workspace-scoped route after the existing authentication and authorization boundary,
  independently of its final HTTP status; it does not label tenant-only routes merely because a
  verified identity is workspace-bound;
- executor request handling derives it from the trusted identity context after the existing route
  and workspace scope checks resolve the request; and
- neither runtime records a client-supplied workspace query value, request body value, or
  unverified identity header.

Platform, tenant-only, anonymous, health, unmatched, and other requests without a trusted
workspace continue to render the current label set with no `workspace_id` label. They do not emit
`workspace_id=""`, `workspace_id="anonymous"`, or a path-derived unvalidated value. Existing
`tenant_id`, normalized `route`, `method`, and `status` behavior remains intact.

Executor `healthz` and `readyz` routes are always workspace-unscoped even when a caller supplies a
gateway-trusted header or workspace-bound credential. Those public routes intentionally bypass
workspace ownership checks, so treating their identity input as metric scope would promote an
unknown or foreign workspace label without the canonical boundary.

Workspace label cardinality is bounded to trusted/resolved workspace identifiers. For the
control-plane, a canonical lookup plus verified own-tenant or platform identity also replaces the
token tenant context with the workspace's resolved owning tenant; this keeps privileged
cross-tenant administration truthful. Authorized canonical `4xx`/`5xx` outcomes retain the
workspace label so `api_requests` and `api_errors` remain complete. Foreign, unknown,
unauthenticated, and unmatched requests never promote a path candidate. No raw object ID, URL,
arbitrary label name, user subject, credential, query string, or response content becomes a
metric label. Histogram labels are not changed by C-04 because workspace series are backed by the
request counter.

Both producer implementations must remain behaviorally identical, and tests exercise them
independently. Copying only the control-plane change was rejected because executor traffic would
remain invisible in legitimate workspace series.

## Decision 5: Return one response shape for data and degradation

Every authorized HTTP `200` returns:

```json
{
  "tenantId": "ten_example",
  "workspaceId": "wrk_example",
  "metricKey": "api_requests",
  "window": "24h",
  "unit": "requests_per_second",
  "points": []
}
```

`tenantId`, `workspaceId`, `metricKey`, `window`, and `points` are always present. `unit` remains
optional in the public schema but, when emitted for the two supported keys, is
`requests_per_second`. The undeclared `source` property is never returned.

Successful Prometheus samples map to `{timestamp, value}` only when the timestamp can be rendered
as an RFC 3339 date-time and the value is a finite number. The handler preserves Prometheus sample
order and does not invent zeroes, interpolate gaps, merge tenant-only legacy history, or translate
provider errors into points.

Prometheus unavailability, timeout/unreachability, non-`2xx` response, invalid JSON, unsuccessful
payload, absent result, or unusable samples degrades to the same response with `points: []`. This
preserves the existing empty-series compatibility while making the empty result explicitly scoped
and schema valid. No provider URL, response body, error text, query, label, or internal status is
added to the public body.

An upstream success with a usable result is not relabeled as another metric/window, and a provider
failure does not turn invalid request parameters into a `200`: validation and authorization occur
before fetch.

## Decision 6: Align OpenAPI without absorbing C-02

The public workspace operation retains required `metricKey` and `window` query parameters.
`metricKey` becomes an enum of `api_requests` and `api_errors`; `window` retains
`5m`, `1h`, `24h`, `7d`, and `30d`. The response continues to reference
`MetricSeriesResponse`, whose required identifiers, closed object shape, optional unit, and point
shape are enforced by contract tests.

The operation's existing `400` declaration remains. The runtime emits a stable bounded error for
C-04 validation, but this proposal does not add the fields missing from the global
`ErrorResponse` implementation or change other routes. That defect remains C-02.

No generated SDK operation or route changes. If public API artifacts are generated from the
canonical OpenAPI source, they are regenerated only as required to keep the enum metadata in sync;
unrelated generated drift is excluded.

## Decision 7: Preserve console, GET, quota, audit, and observability behavior

The console continues to request `api_requests` for the selected supported preset and continues to
consume `points`. Existing workspace presets `24h`, `7d`, and `30d` are retained. The backend also
supports the already published `5m` and `1h` values for API clients. Custom date ranges and a
metric selector UI remain out of scope.

The series operation remains GET and non-mutating:

- it writes no application or metric datastore;
- it emits no domain audit event;
- it consumes or changes no quota and changes no rate-limit class;
- normal HTTP request counters and latency measurement continue;
- provider degradation remains observable through existing internal logging/telemetry boundaries
  without changing the public response; and
- no secret, credential, subject, raw identity header, query, or Prometheus response is logged or
  labeled by this change.

This preserves the existing console UX and cross-cutting governance boundary while correcting the
data returned by the operation itself.

## Decision 8: Prove selection, isolation, schema, and compatibility locally

Focused handler tests inject time and Prometheus fetch behavior and assert:

- both supported keys produce their exact PromQL expressions;
- all five windows produce exact start/end differences and steps;
- two sibling workspaces under one tenant produce distinct workspace matchers;
- label metacharacters are escaped rather than removed or interpreted;
- missing, empty, repeated/ambiguous, and unknown keys/windows return `400` before fetch;
- `storage_bytes` and raw PromQL-like values are rejected;
- success points and every degradation path return the exact allowed response fields;
- same-tenant reads retain current success behavior;
- known foreign and unknown workspace controls retain their distinct current `403` authorization
  and `404` lookup outcomes, respectively, and make no provider request; and
- GET emits no domain audit write.

Registry tests import each runtime implementation separately and prove conditional workspace
labels plus compatibility for tenant-only and anonymous samples. Contract tests validate the
operation enums and real success/degradation bodies against `MetricSeriesResponse`. Console tests
prove the existing `api_requests` plus selected-window request remains stable.

Control-plane scope-propagation tests additionally prove tenant-only and workspace-bound JWT
requests are attributed only after canonical lookup, privileged access uses the resolved owning
tenant, and foreign denials, spoofed headers, unmatched routes, and tenant-only routes cannot
promote a workspace label. Executor propagation tests retain the same positive and negative trust
controls at its existing ownership boundary and prove public probes remain workspace-unscoped for
gateway headers, credentials, and legacy header-trust mode.

The focused test harness uses injected/local fakes and no external network, Prometheus, fixed port,
Docker, credential, or cluster.

A separate later-authorized real-stack regression uses a dedicated local kind kubeconfig and
ephemeral namespaces. It exercises invalid-input short-circuiting, sibling-workspace selector and
sample isolation, foreign-tenant denial without provider access, every accepted window, and the
real console's authoritative empty-series behavior. Its issue profile waits for both the
application and auxiliary ESO/OpenBao namespaces and tears both down. Chart 0.3.1's APISIX
standalone route table is not mounted, so the profile points the console edge directly at the
control-plane: this proves `console → control-plane → Prometheus`, not public ingress/APISIX
routing.

## Documentation

Update `docs/reference/architecture/observability-metrics-time-range.md` with:

- the two supported keys and their rate semantics;
- the exact window/range/step table;
- tenant-plus-workspace selection and the labeled-sample warm-up boundary;
- schema-valid empty degradation with no fabricated values;
- the unchanged console presets and read-only behavior; and
- focused local validation commands.

Do not add audit evidence, loop-state artifacts, shared/staging deployment instructions, product
chart changes, or broad observability documentation. The disposable kind command remains a
bounded regression procedure.

## Rollout and Compatibility

The code can be deployed without a schema or datastore migration. Producer and reader changes
should ship together. During mixed-version rollout, only requests processed by a new producer
create workspace-labeled samples; the reader intentionally excludes all legacy tenant-only
samples. Empty or partial workspace series during this warm-up period are truthful and preferred
to tenant-wide leakage.

Prometheus stores the additive label as a separate series. Existing tenant/platform queries that
aggregate without a `workspace_id` matcher remain compatible and include both labeled and unlabeled
samples according to normal PromQL semantics. Consumers that match the old exact label set continue
to see legacy/unscoped series; C-04 does not rewrite those consumers.

Rollback reverts handler, producer, contract/docs, and tests only. Labeled samples may remain until
normal retention expires; older code ignores them or includes them in tenant-wide aggregation.
There is no down migration and no historical data rewrite.

## Risks

- **Warm-up emptiness:** new workspace queries intentionally exclude old unlabeled history.
- **Scope injection:** unsafe string construction could alter PromQL; closed maps, exact matchers,
  escaping, and adversarial tests prevent this.
- **Incorrect producer attribution:** accepting a raw path/header workspace could mislabel data;
  only trusted/resolved context may supply the label.
- **Cardinality:** arbitrary workspace labels could create unbounded series; trusted canonical IDs
  and existing normalized route/status/method labels bound the set.
- **Query cost:** long windows could request excessive points; fixed steps cap intervals at 360.
- **Mixed runtime behavior:** changing only one producer would omit part of workspace traffic;
  parity tests cover both.
- **Misleading degradation:** fabricated zeroes can resemble real health; degradation is an empty
  identified series only.

## Open Questions

None. Storage/business series, role reconciliation, global error envelopes, APISIX chart
packaging, and deployment changes remain explicitly assigned to other findings or later work.
