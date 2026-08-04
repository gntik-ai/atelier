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

## Flows & MCP signals *(Preview)*

The AI-native capabilities are first-class in the same stack:

- **Flows** — Temporal execution health plus the flow lifecycle audit topic (`FLOW_AUDIT_TOPIC`); per-tenant flow quotas are enforced through the same quota machinery.
- **MCP** — `mcp` is a first-class **audit subsystem** (per-OAuth-client governance events), tenant-scoped and queryable in the console; per-tool-call usage rides the `in_falcone_mcp_tool_invocations_total` metric (business domain `mcp_tool_usage`) with latency on the normalized component-latency family, and the `mcp_tool_invocations` quota dimension surfaces in the per-tenant quota posture. All of these are covered by the `validate:observability-*` checks above. See [MCP Architecture](/architecture/mcp).
