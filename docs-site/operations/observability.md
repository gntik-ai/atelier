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
