# Observability

In Falcone ships a Prometheus-based observability stack (chart alias `observability`) and surfaces per-tenant signals in the console's **Observability** and **Operations** views.

![Observability](/screens/13-observability.png)

## What's collected

| Signal | Purpose |
| --- | --- |
| **Platform metrics** | Service health, request rates, latencies |
| **Usage / consumption** | Per-tenant resource usage (drives quotas & billing inputs) |
| **Quota / limit signals** | Threshold alerts, hard-limit enforcement decisions |
| **Audit pipeline** | Query-safe audit records for governed actions (e.g. function lifecycle) |
| **Business metrics** | Higher-level platform KPIs |

The repository enforces the schema and presence of these via `npm run validate:observability-*` checks (metrics stack, dashboards, health checks, business metrics, usage/consumption, quota policies, threshold alerts, hard-limit enforcement, console alerts, audit pipeline/event-schema/query/export/correlation surfaces).

## Per-tenant visibility

Metrics, usage and audit are **tenant-keyed**, so the console can show one tenant's consumption and operations without exposing another's. Operations records (with detail views) track governed actions and their outcomes.

![Operations](/screens/24-operations.png)

## Quotas & hard limits

A plan's `quota_policy` defines enforced limits and overage behaviour ([Domain Model](/architecture/domain-model#plans-quotas-entitlements)). The observability stack raises **threshold alerts** as usage approaches a limit and records **hard-limit enforcement** decisions when a limit is hit — both visible in the console's Quotas view.

![Quotas](/screens/12-quotas.png)

## Health checks

Each component exposes health/readiness endpoints; `helm upgrade --install` gates on rollout completion. After install:

```bash
kubectl -n falcone rollout status deploy --timeout=300s
kubectl -n falcone get pods
```

### Control-plane probe runbook (C-05)

**Audience and outcome.** This runbook is for P3 platform operators/SREs and the P18 orchestration
actor that consumes probes. P4 security/compliance auditors can use the read-only internal output
to verify status and correlation without changing platform state. Anonymous and public-edge callers
are an adversarial control case: the internal routes must remain unreachable there.

**Status and scope.** This documents the C-05 runtime contract in builds containing
`fix-c05-health-contract-runtime`. Validation below is local-only; this change was not deployed to or
verified on a Kubernetes cluster. The routes report platform scope and do not accept tenant or
workspace selectors.

The control-plane serves the checked-in health contract
(`packages/internal-contracts/src/observability-health-checks.json`). Liveness, readiness and health are
**distinct** concepts and are never collapsed into one generic status.

| Endpoint | Kind | Success | Failure |
| --- | --- | --- | --- |
| `GET /livez` | Process liveness (Kubernetes `livenessProbe`) | `200 {"status":"live"}` | — (never depends on a datastore) |
| `GET /readyz` | Readiness (Kubernetes `readinessProbe`) | `200 {"status":"ok"}` | `503 {"status":"schema_not_ready"}` during bootstrap, `503 {"status":"db_unavailable"}` when PostgreSQL is unreachable |
| `GET /healthz` | Legacy database liveness | `200 {"status":"ok"}` | `503 {"status":"db_unavailable"}` |
| `GET /internal/live` | Liveness rollup (operations) | `200` rollup JSON | domain status in JSON |
| `GET /internal/ready` | Readiness rollup (operations) | `200` rollup JSON | domain status in JSON |
| `GET /internal/health` | Health rollup (operations) | `200` rollup JSON | domain status in JSON |
| `GET /internal/{live\|ready\|health}/components/{id}` | Per-component operational view | `200` component JSON | Canonical `404 GW_NOT_FOUND` for an unknown component (the requested id is never reflected back) |

Only `GET` is served; any other method falls through to the normal `404 GW_NO_ROUTE` and is never treated as a
successful probe.

**The Kubernetes liveness gate is process-only.** `/livez` evaluates the running listener and does **not**
open or await a PostgreSQL connection, so a dependency outage cannot trigger a restart loop. The detailed
PostgreSQL component liveness route does perform a bounded dependency check; it is diagnostic and is not the
Kubernetes restart gate.

#### The seven-component contract

Rollups always contain exactly these components: `apisix`, `kafka`, `postgresql`, `mongodb`, `openwhisk`,
`storage`, `control_plane`. Today only `control_plane` and `postgresql` have in-process adapters; the other
five have no adapter and report **`unknown`** rather than a fabricated `healthy`/`ready` value (fail-closed).
Each adapter is bounded by a per-check timeout (default 1s); a timed-out or failing adapter yields a
sanitized `unknown` / `not_ready` / `unavailable` result with a fixed summary — raw exceptions, credentials,
SQL text and hostnames are never copied into the response.

Allowed statuses per probe type and the aggregate precedence (worst status wins):

| Probe | Allowed statuses | Aggregate precedence |
| --- | --- | --- |
| liveness | `live`, `dead`, `unknown` | `dead` → `unknown` → `live` |
| readiness | `ready`, `not_ready`, `degraded`, `unknown` | `not_ready` → `degraded` → `unknown` → `ready` |
| health | `healthy`, `degraded`, `unavailable`, `unknown`, `stale`, `inherited` | `unavailable` → `degraded` → `stale` → `unknown` → `inherited` → `healthy` |

Because five components report `unknown`, a fully-operational platform rollup is typically `unknown` on the
internal aggregates — this is honest ("no evidence") and must not be read as an outage. Use `/readyz` (not
`/internal/ready`) as the Kubernetes readiness gate.

#### Correlation IDs

Send an `X-Correlation-Id` header (matching `[A-Za-z0-9._:-]{8,128}`) to correlate a probe with your
operational trace. It is echoed in every probe response header and in the `correlation_id` body fields of
the six internal routes; compatibility bodies remain unchanged. If the input is absent or malformed, the
control-plane generates a bounded identifier. Probes are strictly **read-only**: no datastore writes, no
audit mutation, and no new metric families or labels are produced.

#### Internal topology and security

`/internal/*` routes are served only on the control-plane's internal listener. They are **not** registered in
APISIX and **not** proxied by the web-console SPA (which returns `404` for them and never serves the app
shell). Protection relies on network/topology reachability — there is **no** authentication or mTLS on these
routes — so operators must keep the internal listener off the public edge with the existing network controls.

The probe mapping is a single source of truth: `control_plane_probe_mapping` in
`observability-health-checks.json` records `liveness → /livez`, `readiness → /readyz`, and
`compatibility_health → /healthz`,
lists the internal rollup routes, and asserts `gateway_registered: false` and `spa_proxy_registered: false`.
`npm run validate:observability-health-checks` (wired into `validate:repo`) fails if this drifts. The
control-plane image packages the contract JSON and `health-runtime.mjs`; image construction imports the
runtime to reject missing or stale mappings, and production startup fails closed if the contract asset is
missing or invalid.

#### Probe troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `/livez` `200` but `/readyz` `503` | Process alive, a dependency or bootstrap is not ready | Inspect `/internal/ready` and `/internal/ready/components/postgresql` |
| `/readyz` → `schema_not_ready` | Schema bootstrap still running | Wait for the migration/bootstrap to complete |
| `/readyz` → `db_unavailable` | PostgreSQL unreachable | Check the PostgreSQL pod and network path |
| Component shows `unknown` in a rollup | No in-process adapter (expected for `apisix`/`kafka`/`mongodb`/`openwhisk`/`storage`) or the probe timed out | Confirm the component is expected to be adapterless; it is deliberately not counted as healthy |
| `/internal/...` returns the console shell | Request hit the web-console instead of the internal listener | These paths must resolve on the control-plane internal listener, not the SPA |

#### Rollback

Route registration is additive. `/healthz` and `/readyz` retain their previous semantics (including
C-11 schema-readiness gating), so reverting the change simply removes `/livez` and the `/internal/*` routes
without affecting the legacy probes — the rollback is safe and requires no data migration.

#### Verification

From a network location permitted by the internal controls, set the exact internal listener first. The
loopback value below is only an example for a locally started control-plane; do not reuse it blindly for a
cluster:

```bash
FALCONE_CP_INTERNAL=http://127.0.0.1:8080

# process liveness — never touches PostgreSQL
curl -si "$FALCONE_CP_INTERNAL/livez"

# readiness gate used by Kubernetes
curl -si "$FALCONE_CP_INTERNAL/readyz"

# operational rollups and a single component, with a correlation id
curl -si -H 'X-Correlation-Id: ops-check-1' "$FALCONE_CP_INTERNAL/internal/ready"
curl -si "$FALCONE_CP_INTERNAL/internal/health/components/postgresql"
```

Expected checkpoints are `200` plus `{"status":"live"}` for `/livez`, a correlation header on
each response, and a contract-valid JSON rollup/component body on internal routes. A `503` from
`/readyz` is an actionable readiness result, not a liveness failure.

To validate the implementation without a deployment:

```bash
npm run validate:observability-health-checks
node --test tests/blackbox/control-plane-health-contract-c05.test.mjs
node --test tests/blackbox/web-console-health-boundary-c05.test.mjs
node --test tests/unit/control-plane-health-runtime-c05.test.mjs
node --test tests/contracts/control-plane-health-runtime-c05.contract.test.mjs
openspec validate fix-c05-health-contract-runtime --strict
```

All commands are read-only apart from ordinary test temporaries and require no cleanup. C-07 metric
families and labels, component adapter expansion beyond `control_plane`/PostgreSQL, public OpenAPI,
and live-cluster deployment are explicitly outside this remediation.

## APISIX metrics endpoint (C-06)

This deployment has two deliberately different metrics paths:

- The in-cluster Prometheus scrape continues to target `falcone-apisix:9080/apisix/prometheus/metrics`.
- Route `1011-metrics` proxies the public API path to the dedicated APISIX 3.10 exporter at
  `127.0.0.1:9091`.

Port `9091` remains loopback-only and is not published by the chart or a Service. Port `9080` is the
already-declared APISIX surface. Route `1011-metrics` adds no authentication or authorization plugin; it
preserves the exposure and network-policy boundary of `:9080`. Operators must restrict access to this
gateway scrape endpoint using the existing network controls.

When the route is reachable and the exporter is healthy, the response is `200 OK` with `Content-Type:
text/plain` and Prometheus samples such as `apisix_*`. A safe verification from a network location permitted
by those controls is:

```bash
curl -i http://falcone-apisix:9080/apisix/prometheus/metrics
```

Run this from the Falcone namespace (or another origin permitted by the existing network controls). If a
fully qualified service name is required, use `falcone-apisix.<namespace>.svc.cluster.local:9080`. Do not
probe `127.0.0.1:9091` from outside the APISIX pod, and do not expose that port as a workaround.

### Troubleshooting

- **404 Not Found** usually indicates the pre-C-06 route behavior (or a request sent to a path/host that is
  not the configured gateway route). Recheck the gateway host, path, and route registration.
- **502/5xx** after route registration indicates that the route matched but the dedicated exporter was not
  available. Check APISIX pod logs and readiness, then restore the exporter before retrying; do not bypass
  the loopback boundary.

Rollback is the route-level change: revert/remove route `1011-metrics`. That returns the previous behavior,
where the Prometheus target on `falcone-apisix:9080/apisix/prometheus/metrics` is again `404`/down. Accept
that monitoring loss or prepare an alternative scrape path before rollback. This PR does not modify the
external chart and does not change C-05 or C-07 behavior. No deployment is implied by this documentation.

## MCP business-metric export (C-07)

**Audience and outcome.** This runbook is for platform superadministrators (P1), platform
operators/SREs (P3), security/compliance auditors (P4), workspace owners/administrators (P7),
workspace operators/application DevOps users (P9), and scoped viewers/auditors (P10). It lets those
roles read **truthful MCP tool-call usage and latency** from the existing scrape surface instead of
reconstructing it from audit records. MCP OAuth clients and AI/service workloads (P12) are the
activity *producers*, not new scrape consumers. A valid actor from another tenant (P13) is the
isolation control. Documentation maintainers and operators (P17) get the production, troubleshooting,
reset, and rollback contract below.

**Status and scope.** This documents the runtime contract in builds containing
`fix-c07-business-metric-export`. Validation is local/hermetic only; **this change was not deployed to
or verified on a Kubernetes cluster.** It adds no route, listener, port, gateway mapping,
authentication, dashboard, alert, OpenAPI/generated-client, or Helm/Kubernetes change, and it does not
touch the public `/v1/metrics/*` API.

**What changed.** The executor already shaped two signals for every completed MCP tool call
(`apps/control-plane-executor/src/mcp-observability.mjs`) but discarded them — the scrape exposed only
the five legacy `falcone_*` families and no `in_falcone_*` series. C-07 wires those two descriptors
into the executor's process-local registry and renders them on the **same existing `GET /metrics`
endpoint**. No other cataloged business family is exported.

### The two exported families

| Family | Type | Meaning |
| --- | --- | --- |
| `in_falcone_mcp_tool_invocations_total` | counter | MCP tool-invocation volume per verified tenant/workspace, server, tool, OAuth client, and outcome class |
| `in_falcone_component_operation_duration_seconds` | histogram | Normalized component latency. **MCP tool-call latency is the `subsystem="mcp"`, `operation="tool_call"` slice of this shared family** — always select that slice in queries |

Both are served by the **executor** process (the one hosting the MCP engine) at:

```text
GET /metrics
```

`GET /metrics/` is the existing trailing-slash alias. Both paths are `GET` only and return
`Content-Type: text/plain; version=0.0.4; charset=utf-8`. The five legacy
`falcone_*` families (`falcone_http_requests_total`,
`falcone_http_request_duration_seconds_{bucket,sum,count}`, `falcone_process_uptime_seconds`) keep
their exact names, labels, values, and meaning. The endpoint has **no authentication on the handler**;
its reachability is governed by the existing network/topology controls, unchanged here. The separate
control-plane process does **not** mirror these series.

### What produces a sample — and what does not

A sample exists only for a **real, completed, canonically-resolved** MCP tool invocation: the request
had a credential-verified tenant, the server resolved within that tenant with an active published
version, and the requested name resolved to a canonical tool in that manifest. The pair is recorded
**once**, at the shared `call_tool` seam, whether the call arrived through the management HTTP
operation or JSON-RPC `tools/call` — the two transports never double count.

Each completed invocation carries an internal outcome class rendered as `status_class`:

| Concrete path | `status_class` | Recorded? |
| --- | --- | --- |
| Backend returns HTTP 200–299 | `success` | one pair |
| Caller lacks the MCP base scope | `denied` | one pair |
| Caller lacks a mutating tool's declared scope | `denied` | one pair |
| Mutating tool declares no required scope | `error` | one pair |
| Argument/call-shape validation fails | `error` | one pair |
| Backend returns outside HTTP 200–299 | `error` | one pair |
| Backend is unavailable / throws | `error` | one pair |
| Requested tool is not in the active manifest | — | **no pair** (pre-attribution) |

The outcome class comes from the internal invocation result, **never** from parsing caller-visible
error text, result content, or audit detail.

Metric outcomes and historical audit status are separate compatibility contracts. The new metric
uses the three-value class above, while the existing audit detail deliberately keeps its legacy
two-value rule: a caller-visible result with `isError=true` is `error`; a result without `isError`
is `success`. In particular:

| Invocation | Metric `status_class` | Historical audit `detail.status` |
| --- | --- | --- |
| Missing base or declared mutation scope | `denied` | `error` |
| Backend HTTP non-2xx without `isError` | `error` | `success` |
| Unknown tool | no metric pair | `error` audit record |

Do not reconcile Prometheus status buckets one-for-one with audit status buckets or total audit
rows. Use the metrics for invocation outcome/latency and the tenant-scoped audit trail for the
historical governance record; the intentionally different classifications are not evidence of a
partial metric update.

Requests rejected **before** the canonical invocation boundary create **no** sample and never turn the
attempted value into a label: unauthenticated requests, a foreign/unknown/inactive server, a
missing/unknown tool, a malformed message, and a rate limit hit before the invocation begins. There
are no synthetic, pre-seeded, zero-valued, or back-filled series.

### Labels

`in_falcone_mcp_tool_invocations_total` (counter):

| Label | Presence | Value / source |
| --- | --- | --- |
| `environment` | required | bounded `FALCONE_ENVIRONMENT`, falling back to `NODE_ENV` and then `production` |
| `subsystem` | required, fixed `mcp` | static |
| `collection_mode` | required, fixed `push` | static |
| `metric_scope` | required | `tenant` or `workspace` from verified scope — **never `platform`** |
| `domain` | required, fixed `mcp_tool_usage` | static |
| `metric_type` | required, fixed `usage` | static |
| `feature_area` | required, fixed `mcp` | static |
| `operation_family` | required, fixed `execute` | static |
| `tenant_id` | required | credential-verified tenant |
| `server` | required | canonical id from tenant-scoped registry resolution (never a raw URL/path) |
| `tool_name` | required | canonical name in the active published manifest (unknown names never appear) |
| `status_class` | required | `success`, `error`, or `denied` |
| `workspace_id` | workspace scope only | tenant-resolved server workspace; present iff `metric_scope="workspace"`, absent for tenant scope |
| `oauth_client` | optional | a **verified non-secret** OAuth client id derived at the signed-JWT boundary; omitted when unavailable — never a token, secret, or subject |

An authenticated actor id is not automatically an OAuth client id. For a signature-verified JWT,
the identity boundary accepts a bounded printable client id from `azp`, then `client_id`, then
`clientId`; it never uses `sub`. Header-only and API-key identities omit `oauth_client` unless a
future trusted boundary explicitly supplies the verified field. If no valid client id exists,
`oauth_client` is absent from both members of the pair; the exporter never falls back to
`actorId`, a generic `system` value, a token, or an unverified claim.

Set `FALCONE_ENVIRONMENT` to a stable 1–64 character label containing letters, digits, dot,
underscore, or hyphen. When it is unset, the executor uses `NODE_ENV`, then `production`. Invalid
values fail MCP engine construction instead of silently mislabelling a scrape.

The MCP slice of `in_falcone_component_operation_duration_seconds` (histogram) carries the same
attribution labels with the histogram discriminators instead of the counter-only business dimensions:
it omits `domain`, `metric_type`, `feature_area`, and `operation_family`, and adds the required fixed
`operation="tool_call"`. `tenant_id`, `server`, `tool_name`, and `status_class` are required;
`workspace_id`/`oauth_client` follow the same conditional/optional rules; `metric_scope` is again only
`tenant` or `workspace`. This slice policy grants those attribution labels to no other
subsystem/operation slice of the shared histogram.

No PII or high-cardinality field is ever a label: `user_id`, `request_id`, `session_id`, `email`,
`api_key_id`, authorization headers, raw path/query, object keys, workspace/tenant slugs, raw tool
arguments, error messages, result content, tokens, and secrets are all excluded. Canonical identifier
values that contain a backslash, double quote, or line break are Prometheus-escaped at render and
round-trip as one label value; they cannot inject a label, sample, `HELP`, or `TYPE` line.

Latency buckets (cumulative `le`, seconds) for the MCP histogram slice:

```text
0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf
```

followed by `_sum` and `_count`; `le="+Inf"` equals `_count`.

### Empty state and restart

The aggregates are **process memory only**. Before the first real invocation in a process lifetime,
`/metrics` contains **no** MCP counter/histogram sample line — and this build emits the two families'
`HELP`/`TYPE` metadata only once a real sample exists, so an idle executor shows neither. That is the
truthful empty state, **not** a zero. A label tuple that has never completed an invocation is likewise
absent rather than rendered as a placeholder zero.

A restart clears the in-memory aggregates. Values are monotonic within one process lifetime and reset
(become absent until the next real call) on restart — a **normal Prometheus counter reset** that
`rate()`/`increase()` interpret correctly. There is no persistence, replay, or backfill; **absence
means "unknown / no post-start production," never "zero historical usage."**

### Accounting is atomic and best-effort

The counter increment and latency observation are recorded as **one pair** through a single registry
operation (there is no separately callable counter-only or histogram-only mutation). The pair is
validated and its next state computed detached from published state, then published in one commit — so
any pre-commit failure leaves both families byte-for-byte unchanged and there is never a
counter-only/histogram-only half-update. Telemetry is **best-effort**: a shaping or sink failure is
contained, never retried, and can only leave an observability gap — it cannot change, fail, or
duplicate the tool call, and the structured `mcp` audit record is emitted independently.

### Authorization, isolation, and the scrape trust boundary

Reading `/metrics` is governed by the **existing** scrape boundary; this change adds no new route,
listener, port, credential, or per-tenant filtering, and does not claim the document is filtered per
caller. A caller already inside that boundary keeps the same process-wide visibility.

A cross-tenant caller (P13) cannot influence these series: `tenant_id`, `workspace_id`, and `server`
come from credential verification and tenant-scoped resolution, never from JSON-RPC params, tool
arguments, headers, or any caller-supplied hint. A tenant-B request for a tenant-A server keeps its
existing non-enumerating `404` and emits no tenant-A/workspace-A/server/tool series or existence
detail. An arbitrary tool string cannot become a `tool_name` label or inflate cardinality.

### Reading the metrics (PromQL)

Query the counter directly; **always constrain the histogram to the MCP slice** with
`{subsystem="mcp",operation="tool_call"}` (it is one slice of a shared normalized family):

```promql
# Tool-call rate by server and tool
sum by (server, tool_name) (rate(in_falcone_mcp_tool_invocations_total[5m]))

# Error+denied share of MCP calls, per tenant
sum by (tenant_id) (rate(in_falcone_mcp_tool_invocations_total{status_class=~"error|denied"}[5m]))
  / sum by (tenant_id) (rate(in_falcone_mcp_tool_invocations_total[5m]))

# Per-OAuth-client volume (only calls that carried a verified client id)
sum by (oauth_client) (rate(in_falcone_mcp_tool_invocations_total{oauth_client!=""}[5m]))

# p95 tool-call latency by tool (MCP slice only)
histogram_quantile(0.95, sum by (le, server, tool_name) (
  rate(in_falcone_component_operation_duration_seconds_bucket{subsystem="mcp",operation="tool_call"}[5m])))

# Mean tool-call latency (MCP slice only)
sum(rate(in_falcone_component_operation_duration_seconds_sum{subsystem="mcp",operation="tool_call"}[5m]))
  / sum(rate(in_falcone_component_operation_duration_seconds_count{subsystem="mcp",operation="tool_call"}[5m]))
```

`rate()`/`increase()` absorb the restart reset automatically; do not `sum` raw counter values across a
restart.

### C-07 troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| No MCP families at all, even after calls | MCP hosting is disabled | Confirm `MCP_ENABLED=true` on the executor; without it no `/v1/mcp` routes exist and no invocation can occur |
| MCP enabled, families still absent | No canonical tool call has completed since process start | Complete one real tool call; the families appear only after the first real invocation (empty state, not zero) |
| Series missing right after a deploy/restart | Executor is warming from an empty registry | Expected; new samples accumulate after the next real call — treat as a normal counter reset |
| Legacy `falcone_*` present but never any `in_falcone_mcp_*` | Scrape is targeting the separate control-plane process, not the executor | Point the scrape at the executor process that hosts the MCP engine; the control-plane process never mirrors MCP series |
| A specific call ran but no sample appeared | Telemetry shaping/sink was rejected (best-effort), or the call was a pre-attribution rejection (unknown tool, foreign/inactive server, rate limit) | Confirm the call reached a canonical tool; check executor logs for a contained telemetry error — the tool result itself is unaffected |
| A parser rejects the exposition | Reading the wrong endpoint or content type | Verify you scraped the executor `GET /metrics` with `text/plain; version=0.0.4; charset=utf-8`; the render is deterministic and escapes label metacharacters |

### Local verification

To inspect a locally running executor, set its loopback base explicitly. This is not a Kubernetes
Service address and must not be copied into a deployment scrape configuration:

```bash
FALCONE_EXECUTOR_LOCAL=http://127.0.0.1:8080

# Confirm the handler, content type, legacy families, and any post-call MCP samples.
curl -si "$FALCONE_EXECUTOR_LOCAL/metrics"
curl -fsS "$FALCONE_EXECUTOR_LOCAL/metrics" \
  | sed -n '/^# \(HELP\|TYPE\) in_falcone_/p;/^in_falcone_mcp_tool_invocations_total{/p;/^in_falcone_component_operation_duration_seconds_/p'
```

An empty second command is expected before the first real post-start canonical tool call. After
one call, confirm that exactly one counter series and one histogram observation (`_count` increased
by one, with matching attribution and `status_class`) appeared. A missing `oauth_client` is correct
when the call identity did not contain an explicitly verified client id.

Run the focused hermetic suites and contract validators from the repository root; these commands
use in-memory fixtures and ephemeral loopback ports only:

```bash
node --test tests/blackbox/c07-mcp-business-metrics.test.mjs
node --test tests/unit/metrics-registry.test.mjs
node --test apps/control-plane-executor/src/mcp-observability.test.mjs
node --test apps/control-plane-executor/src/runtime/mcp-engine.test.mjs
node --test tests/contracts/observability-business-metrics.contract.test.mjs
node --test tests/contracts/observability-metrics-stack.contract.test.mjs
npm run validate:observability-business-metrics
npm run validate:observability-metrics-stack
openspec validate fix-c07-business-metric-export --strict
```

The black-box suite includes a deterministic Prometheus text parser, so exposition validation does
not silently disappear when optional `promtool` is unavailable. **No command above deploys to,
reads from, or mutates a cluster; C-07 has not been validated on a Kubernetes deployment.**

### Rollback and limitations

Rollback is **additive to remove**: revert the engine sink wiring, the two registry record/render
blocks, the matching contract clarification, the focused tests, and this section. No datastore or
migration cleanup is required, and the legacy `falcone_*` exposition and the existing `/metrics`
boundary stay intact throughout. Rollback intentionally reintroduces the C-07 gap and must **not** be
replaced with fake zero series.

C-07 is limited to these two MCP families. Every other cataloged business/component family
(tenant/workspace lifecycle, API, identity, function, data-service, storage, realtime, quota,
component availability/error/probe, and collection-health) remains **unimplemented** until a separate
change wires a real producer — do not treat its absence as zero.

## Audit

Governed operations (function deployments, admin actions, rollbacks, quota enforcement) produce **query-safe audit records** (`domain-model.json`), retained for compliance and surfaced through the audit query/export/correlation surfaces.

### Audit export (C-10)

Authorized callers can preview a bounded export at the tenant or workspace metrics route:

```text
POST /v1/metrics/tenants/{tenantId}/audit-exports
POST /v1/metrics/workspaces/{workspaceId}/audit-exports
```

The JSON body must include `format`, either `jsonl` or `csv`. `pageSize` is optional (default
`500`) and, when supplied, must be an integer from `1` through `10000`. The console sends
`{"format":"jsonl","pageSize":500,"maskingProfileId":"default_masked"}`. The body may carry the filters already supported by the
audit-record query surface; it does not define authorization scope. Scope comes from the route and
caller identity, and a body scope value cannot broaden it. Authorization permissions are unchanged;
these are instructions for callers already authorized for the target tenant/workspace.

Invalid format, page size, sort, filter, time window, or masking profile is rejected before querying
audit records with a coded 4xx response. The corresponding codes are
`AUDIT_EXPORT_INVALID_FORMAT`, `AUDIT_EXPORT_LIMIT_EXCEEDED`, `AUDIT_EXPORT_INVALID_SORT`,
`AUDIT_EXPORT_INVALID_FILTER`, `AUDIT_EXPORT_INVALID_TIME_WINDOW`, and
`AUDIT_EXPORT_UNKNOWN_MASKING_PROFILE`. A successful response is an inline
`AuditExportManifest` containing the applied filters, counts, correlation metadata, and masked
items. It is a preview manifest, not a durable server-side export artifact; the console's download
control serializes that inline response locally.

An operational store or primary-builder failure returns a coded 5xx response instead of an empty
success or fallback manifest. The conservative inline fallback is used only when the primary builder
is unavailable, not when an available builder fails.

The default `default_masked` profile replaces credential material and provider locators with
`[MASKED]`. If the primary masking path cannot be used, the fallback redacts the full detail field
and remains at least as conservative. The export accepts up to 10,000 records, while the
audit-record list endpoint retains its separate maximum of 200 records per page. Use filters, time
windows and the smallest useful `pageSize` to avoid large payloads. Rollback of the implementation
means reverting the C-10 change/PR. As a caller-side mitigation while rollback is prepared, stop
the request or restore the previous size; no persisted artifact cleanup is required.

Local validation can be run without deploying to Kubernetes:

```bash
node --check apps/control-plane-executor/src/observability-audit-export.mjs
node --test tests/e2e/observability/audit-traceability.test.mjs
```

These checks are local only; they do not deploy or mutate a cluster.

## Flows & MCP signals *(Preview)*

The AI-native capabilities are first-class in the same stack:

- **Flows** — Temporal execution health plus the flow lifecycle audit topic (`FLOW_AUDIT_TOPIC`); per-tenant flow quotas are enforced through the same quota machinery.
- **MCP** — `mcp` is a first-class **audit subsystem** (per-OAuth-client governance events), tenant-scoped and queryable in the console; per-tool-call usage rides the `in_falcone_mcp_tool_invocations_total` metric (business domain `mcp_tool_usage`) with latency on the normalized component-latency family, and the `mcp_tool_invocations` quota dimension surfaces in the per-tenant quota posture. All of these are covered by the `validate:observability-*` checks above. See [MCP Architecture](/architecture/mcp).
