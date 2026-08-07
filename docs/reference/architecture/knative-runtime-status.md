# Knative runtime status, Function, and hosted MCP outage contract

> Maturity: **proposed**. The runtime status API and Function gate are implemented for issue #933,
> as are the application-side hosted MCP and web-console contracts documented here. Managed
> installation remains unavailable: `gntik-ai/falcone-charts#8` is open and unimplemented, and no
> authorized disposable remote OpenShift 4.21 or Kubernetes 1.34 cluster-admin acceptance target is
> available. These source-level contracts do not establish release, deployment, or support
> availability; live managed acceptance is blocked.

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

Function read and write scopes are deliberately different:

- a verified `tenant_owner` or `tenant_admin` may read Function metadata across workspaces in its
  own tenant without carrying a workspace claim;
- a platform-trusted `platform_operator`, `platform_auditor`, `platform_admin`, or `superadmin` may
  read Function metadata platform-wide;
- a tenant-realm identity with a copied platform role, or a roleless identity that only sets
  `actor_type`, receives no platform-reader authority; and
- create, update, invoke, rollback, and delete remain bound to the exact tenant and workspace in the
  verified identity. A same-tenant role without the required workspace claim cannot mutate another
  workspace's Function.

Successful create, update, invoke, rollback, and delete results carry the persisted Function's
tenant, workspace, and resource audit scope. The route audit writer uses that result scope rather
than an untrusted or absent request workspace, so an adjacent workspace audit cannot see the event.

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
platform-only route. Both detail and list items use the Function-specific public representation:
`status` and `provisioning.state` distinguish `active`, `unavailable`, and `deletion_pending`, while
`runtimeDependency` carries only the bounded dependency state. The public OpenAPI schemas describe
these same states instead of treating Function lifecycle as a generic provisioning resource.

The console presents `ready`, `unavailable`, `unverified`, and `disabled` as distinct states with a
bounded reason and user-actionable text. On the runtime page, a successful initial route load does
not move focus away from the navigation control that opened the page. After an error or an explicit
retry, focus is restored to the retry/recheck control when the request completes. Function update,
invoke, rollback, and delete controls are disabled for both `unavailable` and `deletion_pending`,
and each disabled control references the accessible explanation for that state. Active Function
affordances remain available. Hosted MCP detail and Playground views show dependency state before
allowing invoke.

## Hosted MCP authorization and public operations

Hosted MCP routes derive tenant and workspace authority from the verified identity, never from the
request body or JSON-RPC parameters. If the identity carries a singular `workspace_id`, that value
must match the route workspace. If it carries plural `workspace_ids`, the route workspace must be a
member. The binding is enforced consistently for server list, detail, audit, REST tool-call, and
JSON-RPC routes before runtime status is inspected or a hosted tool is dispatched. A caller bound
only to an adjacent workspace therefore receives a tenant-safe denial without a Knative reason,
server detail, or tool result.

The public management surface includes:

```http
GET  /v1/mcp/workspaces/{workspaceId}/servers
GET  /v1/mcp/workspaces/{workspaceId}/servers/{serverId}
GET  /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/audit
POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/curations
POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions
POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions/{version}/approval
POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls
POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc
```

The curation operation is a workspace-scoped, bearer-authenticated public API. It applies tool
enablement, description overrides, and per-tool scopes to the generated draft, then returns the
curated tools and bounded publish-gate violations; it does not itself publish or activate a version.
Its authoritative OpenAPI operation, generated MCP family, route catalog, and
[public API surface](./public-api-surface.md#mcp) are generated from the same contract.

## Hosted MCP publication and invocation

Publishing first generates and curates the draft, runs the publish gate, registers the named
version, and persists the exact normalized manifest associated with that version. A version that
does not require review reconciles that stored manifest, version, operation, workspace, pinned
runtime image, and correlation ID to the runtime. A review-held version remains
`requires_review`, leaves the prior version active, and causes no runtime reconciliation. Approval
then activates and reconciles the exact persisted manifest that was reviewed; later edits to the
mutable draft cannot change the approved deployment contract.

Both the REST tool-call endpoint and JSON-RPC `tools/call` path dispatch a hosted invocation as a
JSON-RPC 2.0 `tools/call` request. The runtime adapter supplies tenant ID, workspace ID, caller
roles, granted scopes, active version, and correlation ID from the credential-bound server and
verified caller context. It removes top-level `tenantId`, `tenant_id`, `workspaceId`, and
`workspace_id` fields from caller arguments before dispatch, so a tool call cannot smuggle an
ownership boundary. The remaining arguments, tool name, and request ID are preserved. Runtime
errors remain bounded MCP/HTTP errors; they do not replace the server-derived authorization
context with caller input.

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

### Hosted MCP cleanup

Hosted MCP cleanup fails closed across both runtime readiness and Kubernetes object replacement:

1. list each supported namespaced resource kind by the exact Falcone tenant and MCP-server labels;
2. parse the Kubernetes `List` response and treat only HTTP `404` as already absent;
3. reject malformed responses and every other non-2xx response, including `401`, `403`, and `500`;
4. require the observed object's name, UID, and `resourceVersion` before any delete;
5. send both UID and `resourceVersion` as Kubernetes delete preconditions; and
6. re-list the exact ownership selector after a successful or `404` delete and finalize only after
   absence is verified.

Missing preconditions, a `409` replacement conflict, an authorization/transport error, malformed
JSON, or an object still present after delete is not success. The public delete returns HTTP `202`
with `status: deletion_pending`; the logical hosted MCP owner remains readable and the same atomic
state transaction creates or reuses its durable cleanup obligation. Retries preserve the original
correlation ID. Recovery removes the logical server/registry state only when owner-scoped runtime
cleanup has completed.

Tenant or capability teardown follows the same rule. While any hosted MCP cleanup obligation is
pending, logical metadata is retained and the MCP teardown domain reports an error. The aggregate
tenant purge therefore remains incomplete and cannot publish a successful teardown finalization.

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
