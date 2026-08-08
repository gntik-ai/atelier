# Knative runtime status, Function, and hosted MCP outage contract

> Maturity: **proposed**. The runtime status API and Function gate are implemented for issue #933,
> as are the application-side hosted MCP and web-console contracts documented here. Managed
> installation remains unavailable: although `gntik-ai/falcone-charts#8` is merged (PR #9) and the
> `falcone-knative` runtime chart 0.1.0 is published, no authorized disposable remote OpenShift 4.21
> or Kubernetes 1.34 cluster-admin acceptance target has yet run the required acceptance. These
> source-level contracts do not establish release, deployment, or support availability; live managed
> acceptance is blocked.

## Scope and actors

The status is installation-wide. P3 platform operators, P10 read-only auditors, platform
administrators, and superadministrators may read it. P8 Function developers receive only the
bounded dependency state needed for their own tenant/workspace resource. P13 adjacent tenants
cannot use an identifier or error response to discover another tenant's Function, Knative Service,
revision, endpoint, logs, source, owner, or cleanup queue.

There is no HTTP mode mutation route. Mode and readiness come from installer/chart configuration.

## Supported prerequisite and evidence provenance

The [current installation guide](../../../docs-site/guide/installation.md#chart-shape) remains the
supported prerequisite: OpenShift uses the OpenShift Serverless Operator and an administrator-owned
`KnativeServing`; the repository's kind manifests are development-only. The
[managed integration page](../../installation/managed-knative-proposed.md) is a proposal, not a
replacement installation procedure.

Coordinated managed delivery is tracked by
[`gntik-ai/falcone#933`](https://github.com/gntik-ai/falcone/issues/933) and
[`gntik-ai/falcone-charts#8`](https://github.com/gntik-ai/falcone-charts/issues/8). Chart issue #8 is
merged (PR #9) and the `falcone-knative` runtime chart 0.1.0 is published, so the bundle and
cluster-administrator lifecycle command are implemented. There is still no authorized disposable
remote OpenShift 4.21 or Kubernetes 1.34 cluster-admin target, so clean-install, upgrade, rollback,
`restricted-v2`, and cleanup acceptance have not run and release availability remains blocked.

This reference is grounded in the
[OpenSpec proposal](../../../openspec/changes/add-managed-knative-serving/proposal.md), the
[hosted MCP requirements](../../../openspec/changes/add-managed-knative-serving/specs/mcp/spec.md),
and the source-level
[managed Knative black-box tests](../../../tests/blackbox/managed-knative/). In particular, the
stable test IDs used for this review include `bbx-933-mcp-rpc-response-31`,
`bbx-933-mcp-external-canary-response-36`, `bbx-933-mcp-route-errors-33`,
`bbx-933-mcp-central-audit`, `bbx-933-mcp-plural-workspace-binding-27`,
`bbx-933-mcp-cleaner-production-list-28` through `bbx-933-mcp-cleanup-api-retention-31`,
`bbx-933-mcp-runtime-wire-context-32`, and `bbx-933-mcp-review-reconcile-33`. Source revision
`d27065f0` was the documentation review point; it is evidence provenance, not a release, chart,
support, or compatibility version. The real-stack `issue-933-*` Playwright scenarios remain
acceptance specifications rather than live proof while the external prerequisites are blocked.

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
Because curation is a product mutation, callers must also send an `Idempotency-Key` together with
`X-API-Version` and `X-Correlation-Id`.
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
verified caller context. It also delegates the caller's Bearer or Falcone API-key credential through
the cluster-local managed runtime to the explicitly configured `control-plane-executor` Service, so
the second hop independently re-verifies the caller. The deployment adapter accepts only an
absolute HTTP(S) origin from `MCP_RUNTIME_API_BASE_URL`, writes it to the Knative Service as the
non-secret `FALCONE_API_BASE_URL`, and rejects missing or path-bearing destinations before any
Kubernetes mutation. A runtime started without that destination reports unavailable readiness;
the `x-*` context headers are not sufficient authorization on their own. The credential is used only
for that request and is not placed in the Knative manifest, runtime environment, audit event, or
metric. The adapter removes top-level `tenantId`, `tenant_id`, `workspaceId`, and
`workspace_id` fields from caller arguments before dispatch, so a tool call cannot smuggle an
ownership boundary. The remaining arguments, tool name, and request ID are preserved. Runtime
errors remain bounded MCP/HTTP errors; a downstream non-2xx response becomes an MCP error and can
never be returned as `isError: false`. Errors do not replace the server-derived authorization
context with caller input.

Hosted tool invocation requires the caller's granted `mcp:invoke` scope. A mutating published tool
also requires its curated tool-specific scope. Curation or server ownership cannot synthesize either
scope for a later caller.

### JSON-RPC unavailable contract

When `MCP_ENABLED=true`, the hosted routes exist independently of Knative readiness. An
authenticated, owner-scoped JSON-RPC request whose selected runtime is `unverified`, `degraded`,
`unavailable`, or `disabled` receives HTTP `200` with this exact error shape:

```json
{
  "jsonrpc": "2.0",
  "id": 93304,
  "error": {
    "code": -32005,
    "message": "Hosted MCP runtime is unavailable.",
    "data": {
      "code": "KNATIVE_UNAVAILABLE",
      "state": "degraded",
      "reason": "CONTROL_PLANE_NOT_READY",
      "correlationId": "corr-outage-mcp-rpc"
    }
  }
}
```

`state`, `reason`, and `correlationId` reflect the normalized dependency and request, but the error
code and message are fixed. The response contains no fabricated `result`. Knative `state: disabled`
in this contract means hosting is enabled but the selected runtime mode is disabled; it is distinct
from `MCP_ENABLED=false`. With MCP hosting disabled, the engine is not registered and `/v1/mcp/*`
falls through as an absent route rather than returning `KNATIVE_UNAVAILABLE`.

Authentication, structural role/workspace binding, and tenant-safe server ownership run before the
dependency gate. Missing authentication remains HTTP `401`; a wrong workspace or foreign/missing
server preserves its `403`, `404`, or JSON-RPC `-32001` tenant-safe outcome and discloses no Knative
state. Only after these checks does runtime unavailability produce `-32005`.

For an authenticated notification without an `id` sent while the server is unavailable, Falcone
records the correlated unavailable audit event, invokes no tool, and returns HTTP `202` with an
empty body. JSON-RPC notifications never receive an error object.

Operators and authorized auditors can follow an event through either the server-local audit read
or the unified workspace/correlation surfaces:

```http
GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/audit
GET /v1/metrics/workspaces/{workspaceId}/audit-records?filter[correlationId]={correlationId}
GET /v1/metrics/workspaces/{workspaceId}/audit-correlations/{correlationId}
```

The unified tenant variants are available at `/v1/metrics/tenants/{tenantId}/audit-records` and
`/v1/metrics/tenants/{tenantId}/audit-correlations/{correlationId}`. Each query remains scoped by
the verified platform/tenant/workspace authorization; a copied tenant-realm operator/auditor role
does not grant platform audit access.

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

### Distinguish hosting disabled from runtime unavailable

- If `MCP_ENABLED=false`, `/v1/mcp/*` is not registered. An absent-route response is intentional
  hosting disablement; do not diagnose it as a Knative outage.
- If MCP hosting is enabled and `KNATIVE_RUNTIME_MODE=disabled`, stored metadata/audit routes remain
  addressable, while a hosted JSON-RPC request returns `-32005` with `state: disabled`.
- In external mode, `state: unverified` plus an `EXTERNAL_CANARY_*` reason means hosting exists but
  the administrator-supplied canary has not proved the runtime. In managed mode, `unavailable` or
  `degraded` reports a closed source-of-truth gate. An authorized platform operator can confirm the
  normalized mode/state/reason with `GET /v1/platform/runtime/knative`; tenant developers receive
  only the bounded `runtimeDependency` on their own resource.

### Distinguish cleanup pending from complete

HTTP `202` with `deletion_pending` is acceptance of a durable obligation, not proof that Kubernetes
resources are gone. While pending, Function detail continues to return
`status: deletion_pending`; hosted MCP detail returns `lifecycleStatus: deletion_pending`; and
aggregate tenant/capability teardown remains incomplete. Reuse the returned correlation ID with the
workspace audit endpoints above. Cleanup is complete only after owner-scoped absence verification,
the logical record is no longer readable, and the correlated recovery/completion audit is present.
Do not manually delete the logical owner or obligation to silence a pending state.

### Runtime status errors

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
