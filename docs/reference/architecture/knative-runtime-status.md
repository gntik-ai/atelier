# Knative runtime status and Function outage contract

> Maturity: **proposed**. The runtime status API and Function gate are implemented for issue #933,
> but managed installation remains unavailable until the companion chart and disposable-cluster
> acceptance are complete. Hosted MCP wiring and web-console presentation are separate delivery
> slices and are not claimed by this page.

## Scope and actors

The status is installation-wide. P3 platform operators, P10 read-only auditors, platform
administrators, and superadministrators may read it. P8 Function developers receive only the
bounded dependency state needed for their own tenant/workspace resource. P13 adjacent tenants
cannot use an identifier or error response to discover another tenant's Function, Knative Service,
revision, endpoint, logs, source, owner, or cleanup queue.

There is no HTTP mode mutation route. Mode and readiness come from installer/chart configuration.

## Read-only platform route

```http
GET /v1/platform/runtime/knative
Authorization: Bearer <platform token>
X-API-Version: 2026-03-26
X-Correlation-Id: <trace token>
```

Allowed roles are `platform_operator`, `platform_auditor`, `platform_admin`, and `superadmin`, and
the token must be platform-trusted. A tenant-realm token carrying a copied platform role, or a
roleless token whose `actor_type` says superadmin, receives `403`; role names are not sufficient
without the verifier's trust context. The console calls this protected route through its
authenticated session transport and never exposes a bearer token to page code.
Tenant/workspace roles receive `403`; an absent or invalid identity receives `401`.

Example unavailable response:

```json
{
  "mode": "managed",
  "owner": "unknown",
  "version": null,
  "compatibility": "unverified",
  "state": "unavailable",
  "stage": "unknown",
  "reason": "STATUS_FILE_UNAVAILABLE",
  "lastTransitionAt": null
}
```

The status route is observational. Reading it cannot change mode, install a CRD, probe or create a
canary, patch an owner marker, or trigger reconciliation.

## Fail-closed normalization

The workload gate opens only for normalized `state: ready`. Important closed states include:

| Input condition | Published state | Stable reason |
|---|---|---|
| status file missing or unreadable in managed mode | `unavailable` | `STATUS_FILE_UNAVAILABLE` |
| malformed/oversized/unknown-schema file | `unavailable` (managed) or `unverified` (external) | `STATUS_FILE_INVALID` |
| file mode differs from configured mode | `unavailable` (managed) or `unverified` (external) | `STATUS_MODE_MISMATCH` |
| version is not 1.22.1 | `unavailable` | `VERSION_UNSUPPORTED` |
| external canary absent | `unverified` | `EXTERNAL_CANARY_MISSING` |
| external canary unreadable | `unverified` | `EXTERNAL_CANARY_UNREADABLE` |
| external canary invoke failed | `unverified` | `EXTERNAL_CANARY_INVOKE_FAILED` |
| deliberate disabled mode | `disabled` | `RUNTIME_DISABLED` |

The application logs neither the status file body nor raw parsing/read errors. Public responses
carry bounded enums/reason codes only.

## Function operations

Authorization and tenant-safe resource lookup precede dependency disclosure. After ownership is
proven, deploy, update, invoke, and rollback check the source-of-truth runtime before secret
resolution, readiness probes, Kubernetes calls, registry writes, version activation, or successful
activation recording.

When Functions are enabled but Knative is not ready, those operations return HTTP `503`:

```json
{
  "code": "KNATIVE_UNAVAILABLE",
  "message": "Knative runtime is unavailable.",
  "mode": "external",
  "state": "unverified",
  "reason": "EXTERNAL_CANARY_UNREADABLE",
  "correlationId": "corr-8c0bde2f"
}
```

The response does not contain a Knative Service name, revision, endpoint, owner, status-file path,
cluster resource, or another tenant identifier. When `FUNCTIONS_ENABLED=false`, the same operation
instead returns HTTP `501`, code `FUNCTIONS_DISABLED`, preserving capability-off semantics.

Metadata reads remain available. A tenant-scoped Function response adds:

```json
{
  "status": "unavailable",
  "provisioning": { "state": "unavailable" },
  "runtimeDependency": {
    "mode": "managed",
    "state": "degraded",
    "reason": "CONTROL_PLANE_NOT_READY",
    "ready": false
  }
}
```

Tenant metadata intentionally omits the runtime owner/version and cluster detail exposed by the
platform-only route.

The console presents `ready`, `unavailable`, `unverified`, and `disabled` as distinct states with a
bounded reason and user-actionable text. Retry is available for recoverable states and preserves
keyboard focus; dependent Function and MCP actions remain disabled while `ready: false`. Hosted MCP
detail and Playground views show dependency state before allowing invoke.

## Outage deletion and recovery

An authorized Function delete while the runtime gate is closed makes one atomic database change:

1. set the Function `lifecycle_status` to `deletion_pending`; and
2. insert or reuse a unique `(function, tenant, resource, delete)` cleanup obligation.

It returns HTTP `202` with `status: deletion_pending` and the obligation's original correlation ID.
A retry returns the same pending outcome. No Knative request is made and the Function row remains
available for honest status reads.

The durable obligation stores only tenant/workspace/resource identifiers, the owned runtime
resource name, correlation ID, bounded state/attempt/error fields, and timestamps. It stores no
source, parameters, secrets, credentials, endpoints, logs, or free-form error text. The schema is
shared with `resource_type: mcp` so the hosted MCP slice can use the same lifecycle contract.

A bounded recovery worker runs after control-plane startup and every 30 seconds. It does nothing
while the runtime is unavailable. Once ready, it claims at most 25 Function obligations with
`FOR UPDATE SKIP LOCKED`, idempotently deletes the owned Knative Service (`404` is already treated as
success), and atomically removes only the matching tenant/resource Function rows before marking the
obligation complete. Failure returns the obligation to `pending` with a bounded code for a later
retry. It never deletes by an unscoped resource name.

## Audit and metrics expectations

Function dependency failures and cleanup transitions use the HTTP correlation ID. Audit events are
tenant/workspace scoped and may contain operation, mode, bounded state/reason, result, and
correlation ID. They must not contain source code, parameters, tokens, credentials, status-file
content, endpoints, or raw exceptions. Operational metrics use bounded capability/operation/mode/
state/reason/result labels and never resource, Function, Knative Service, tenant, workspace, or
principal names. Prometheus output uses bounded route templates rather than raw paths. Tenant-scoped
series cannot be presented as global data. Platform-trusted operators and auditors have read-only
observability access; tenant-realm copied roles do not. Audit queries support the `correlationId`
filter so cleanup and dependency transitions can be followed without exposing secrets.

## Troubleshooting

For `STATUS_FILE_UNAVAILABLE`, verify that the chart mounted the configured absolute path and uses
an atomic file replacement. Do not paste file contents into tickets if they contain fields outside
the v1 schema; regenerate the file from the lifecycle command.

For `STATUS_FILE_INVALID`, validate the v1 schema, the 16 KiB limit, bounded reason, readiness stage,
and ISO-8601 transition time. A raw exception is intentionally unavailable from the API.

For `VERSION_UNSUPPORTED`, do not override the gate. Compare the detected version with the fixed
1.22.1 compatibility boundary and use the coordinated upgrade/acceptance procedure.

For external canary errors, restore read and invoke access to the administrator-supplied canary.
Falcone will not create a replacement. After the chart publishes verified readiness, confirm that
pending cleanup decreases and correlate any retained obligation using its correlation ID.
