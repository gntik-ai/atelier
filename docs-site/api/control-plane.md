# API Reference: Control Plane

The generated OpenAPI file is:

```text
apps/control-plane-executor/openapi/control-plane.openapi.json
```

It identifies the public API as `In Falcone Public API`, version `1.21.0`, with versioned routes
under `/v1`. Public gateway routes are catalogued in:

```text
deploy/gateway-config/public-route-catalog.json
```

The runnable control-plane and executor also carry local runtime route tables in:

```text
apps/control-plane/routes.mjs
apps/control-plane/b-handlers.mjs
apps/control-plane-executor/src/runtime/server.mjs
```

## Base URL

Through the gateway:

```text
https://<api-host>/v1/...
```

When port-forwarding the local quickstart, direct service URLs are:

```text
http://127.0.0.1:8080/v1/...   # control-plane service
http://127.0.0.1:8082/v1/...   # control-plane-executor service
```

## Version and correlation headers

> **Repository status (2026-08-08): implemented and validated, not rolled out.** The runtimes,
> in-repository APISIX/runtime CORS configuration, public contracts, and first-party callers contain this
> behavior, but no cluster was updated as part of C-03. The companion `falcone-charts` repository
> still lists `X-Correlation-Id` as required in both
> `claimsPropagation.requiredRequestHeaders` and APISIX `request-validation.header_schema.required`.
> Update that chart and roll out matching control-plane/executor images before relying on optional
> ingress correlation. Verify the deployed chart and image digests first; the post-rollout probe
> below must pass before declaring the installation aligned.

Every matched, published, non-exempt `/v1` operation must send exactly
`X-API-Version: 2026-03-26`, including public login and signup operations. Runtime listeners are the
authoritative executable validation boundary. Gateway policy declares the same contract. The
in-repository APISIX `/v1` routes disable the route-local CORS plugin because it would terminate
preflight before the catalog-aware listener; the runtimes instead emit the allow/expose headers on
preflight, JSON, proxy, and SSE responses. Dedicated `OPTIONS` routes for the Postgres, Mongo, Events,
and Functions API-key families select the executor without requiring the eventual `apikey` value, which
a browser does not send during preflight. Registered realtime and flow-monitoring streams participate in
the same route-aware preflight decision even though they are runtime-only streaming routes. Both runtimes
advertise the complete public request-header set, including `apikey`, `X-Api-Key`, `Last-Event-ID`,
`X-Origin-Surface`, conditional/range headers, and the trace headers; they expose correlation,
idempotency/rate-limit, and range response metadata. On a
protected route, runtime authentication happens first: missing or
invalid credentials retain `401`. After authentication—or immediately for a route that requires no
authentication—a missing version returns `400 GW_API_VERSION_REQUIRED`; an old, unknown, duplicate,
or comma-combined version returns `400 GW_UNSUPPORTED_API_VERSION`. Validation occurs before
authorization or domain work.

`X-Correlation-Id` is optional on ingress. When omitted, the service generates a safe value; when
supplied, it must be a single valid value and is preserved. Empty, malformed, or duplicate values
return `400 GW_INVALID_CORRELATION_ID`, with a newly generated safe correlation value used for the
response. Every matched, non-exempt response (including errors) returns `X-Correlation-Id`; the error envelope repeats
the same value in `correlationId`. Browsers may read that response header because it is exposed by
CORS. For the in-repository APISIX routes that can reject with `429` before proxying, a rewrite/header-filter
boundary preserves a valid supplied value or uses a safe NGINX request identifier; it never reflects an
invalid supplied correlation. `OPTIONS`, root, health/readiness/liveness, metrics, internal, and native passthrough routes
remain exempt from public header validation.

Example authenticated request and response:

```http
GET /v1/metrics/tenants/tenant-123/quotas HTTP/1.1
Authorization: Bearer <access-token>
X-API-Version: 2026-03-26
X-Correlation-Id: ops-20260808-1234

HTTP/1.1 200 OK
X-Correlation-Id: ops-20260808-1234
```

For a generated correlation value, omit `X-Correlation-Id` and retain the response header for
support diagnostics. Do not put correlation values, API keys, or bearer tokens in URL paths or
query parameters. The web console's SSE streams use `fetch`/`ReadableStream` so they can send the
same headers; its JSON and raw-response callers share the same trace-header transport. The legacy
`?apikey=` query parameter remains only as an identity fallback for browser stream routes.

### Capture the returned correlation

For command-line diagnosis, keep credentials in environment variables and write response metadata
to temporary files. This example intentionally omits request correlation so it also verifies that
the deployed edge generates and returns one:

```bash
export API=https://api.example.com
export ACCESS_TOKEN='<access-token>'
export TENANT_ID=tenant-123

headers_file="$(mktemp)"
body_file="$(mktemp)"
curl --silent --show-error \
  --dump-header "$headers_file" \
  --output "$body_file" \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header 'X-API-Version: 2026-03-26' \
  "$API/v1/metrics/tenants/$TENANT_ID/quotas"

correlation_id="$(awk 'BEGIN { IGNORECASE=1 } /^X-Correlation-Id:/ { gsub(/\r/, "", $2); print $2 }' "$headers_file")"
test -n "$correlation_id" && printf 'correlation=%s\n' "$correlation_id"
sed -n '1,20p' "$body_file"
rm -f "$headers_file" "$body_file"
```

Expected result after an aligned rollout: an authenticated request with the current version
succeeds without a request `X-Correlation-Id`, and the command prints one value matching
`^[A-Za-z0-9._:-]{8,128}$`. A gateway `400` that says correlation is required means the companion
chart is still enforcing its old schema; a `200` without the response header means the deployed
runtime image predates C-03.

Browser and Node.js callers can read the CORS-exposed value directly:

```js
const response = await fetch(`${API}/v1/metrics/tenants/${TENANT_ID}/quotas`, {
  headers: {
    authorization: `Bearer ${accessToken}`,
    'X-API-Version': '2026-03-26'
  }
})
const correlationId = response.headers.get('X-Correlation-Id')
if (!correlationId) throw new Error('The deployed public trace-header contract is not aligned')
console.log({ status: response.status, correlationId, body: await response.json() })
```

### Header errors and safe retries

| Code | Meaning | Client action |
| --- | --- | --- |
| `GW_API_VERSION_REQUIRED` | The version header is missing or empty. | Add the current version; do not retry unchanged. |
| `GW_UNSUPPORTED_API_VERSION` | The value is stale, unknown, duplicated, or ambiguous. | Send exactly `2026-03-26`; do not retry unchanged. |
| `GW_INVALID_CORRELATION_ID` | A supplied correlation is empty, duplicated, or outside the public pattern. | Replace it with a new safe value, or omit it and let the edge generate one. |

Trace-header `400` responses are not transient. For `429`, `502`, `503`, or `504`, use bounded
backoff and honor `Retry-After` when present. A retry of the same logical operation keeps the same
valid `X-Correlation-Id`. A retry of a mutating request must also keep the same
`Idempotency-Key`; create both new identifiers only when starting a new logical operation. Never
retry a non-idempotent mutation automatically without the idempotency contract.

### Diagnose by correlation

Use the response value, not an unvalidated request value. For tenant-scoped audit evidence:

```bash
encoded_correlation="$(node -p 'encodeURIComponent(process.argv[1])' "$correlation_id")"
curl --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header 'X-API-Version: 2026-03-26' \
  --header "X-Correlation-Id: $correlation_id" \
  "$API/v1/metrics/tenants/$TENANT_ID/audit-records?filter%5BcorrelationId%5D=$encoded_correlation"
```

The expected audit page contains only records visible to the authenticated tenant-scoped caller
and each matching record carries the same correlation. A valid empty result means no durable audit
event was emitted for that request; it is not evidence of another tenant's activity.

For an operator investigating a sanitized `5xx`, search the control-plane and executor log sink for
the exact safe value. The runtimes attach `correlationId` to their server-side error records:

```bash
kubectl -n "$FALCONE_NAMESPACE" logs deployment/falcone-control-plane --since=15m \
  | rg --fixed-strings -- "$correlation_id"
kubectl -n "$FALCONE_NAMESPACE" logs deployment/falcone-control-plane-executor --since=15m \
  | rg --fixed-strings -- "$correlation_id"
```

Deployment names may be release-prefixed; obtain them from `kubectl -n "$FALCONE_NAMESPACE" get
deploy` instead of guessing. HTTP request metrics intentionally aggregate by bounded labels such as
route, method, status, tenant, and workspace; correlation is not a Prometheus label because it
would create unbounded cardinality. Use the response timestamp and route/status to relate aggregate
metrics to the audit/log evidence, not a correlation-label query. If logs and audit are both empty,
confirm the deployed image digests and logging retention before escalating with the response
status, timestamp, sanitized route, and correlation—never the token or API key.

## Authentication

| Method | Public form | Notes |
| --- | --- | --- |
| Bearer JWT | `Authorization: Bearer <jwt>` | Used by operators, tenant owners, workspace users, and service-account clients. |
| API key | `apikey: flc_...` | Executor data-plane routes support API-key identity when issued for a workspace. |
| SSE query key | `?apikey=flc_...` | Compatibility identity for browser stream routes; first-party clients still send trace headers. Header identity wins when both are present. |

Tenant and workspace identity must come from a verified credential or trusted gateway headers. Do
not send tenant/workspace IDs as a substitute for authentication.

## Tenant and workspace routes

Generated OpenAPI exposes canonical tenant and workspace mutations:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/tenants` | List or create tenants. |
| `GET` / `PUT` / `DELETE` | `/v1/tenants/{tenantId}` | Read, update, or delete a tenant. |
| `GET` / `POST` | `/v1/workspaces` | List or create workspaces in the generated contract. |
| `GET` / `PUT` / `DELETE` | `/v1/workspaces/{workspaceId}` | Read, update, or delete a workspace. |

The current local control-plane runtime also supports:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` / `GET` | `/v1/tenants/{tenantId}/workspaces` | Create or list workspaces for one tenant. |
| `GET` | `/v1/tenants/{tenantId}/environments` | List tenant environments. |
| `POST` | `/v1/tenants/{tenantId}/exports` | Export non-secret tenant configuration. |
| `POST` | `/v1/workspaces/{workspaceId}/promotions` | Promote workspace definitions between environments in the same tenant. |
| `POST` | `/v1/workspaces/{workspaceId}/clone` | Clone a workspace inside the same tenant. |

The workspace `environment` field is the stage boundary. The generated contract allows `dev`,
`sandbox`, `staging`, `prod`, and `preview`.

## Service accounts and credentials

The current workspace-scoped runtime routes are:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/workspaces/{workspaceId}/service-accounts` | List or create service accounts. |
| `GET` / `DELETE` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}` | Read or delete one service account. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance` | Issue a credential. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations` | Rotate credentials. |
| `POST` | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations` | Revoke credentials. |

Do not use old examples that mint keys with `POST /v1/api-keys`; the current developer docs use
workspace service accounts and the executor's workspace API-key management routes.

## Functions

Generated OpenAPI exposes governed function actions:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/functions/actions` | Deploy a function action. |
| `GET` / `PATCH` / `DELETE` | `/v1/functions/actions/{resourceId}` | Read, update, or delete an action. |
| `POST` | `/v1/functions/actions/{resourceId}/invocations` | Invoke an action. |
| `GET` | `/v1/functions/actions/{resourceId}/activations` | List activations. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}` | Read one activation. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}/logs` | Read activation logs. |
| `GET` | `/v1/functions/actions/{resourceId}/activations/{activationId}/result` | Read activation result. |
| `GET` | `/v1/functions/actions/{resourceId}/versions` | List versions. |
| `POST` | `/v1/functions/actions/{resourceId}/rollback` | Roll back to a retained version. |

Functions run as Knative Services created at runtime by the control-plane. On OpenShift, that
requires OpenShift Serverless.

## Data APIs

Current data routes are workspace-addressed. See the dedicated pages:

| Capability | Route family |
| --- | --- |
| PostgreSQL rows | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows` |
| Mongo/FerretDB documents | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents` |
| Event topics | `/v1/events/topics` in OpenAPI, and `/v1/events/workspaces/{workspaceId}/topics` in the runtime executor. |
| Realtime | `/v1/realtime/workspaces/{workspaceId}/...` |

The older `/v1/collections/{name}/documents` examples are no longer used in this docs path.

## Flows routes

Flows are Preview and are served by the control-plane executor when Temporal is wired.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/flows/workspaces/{workspaceId}/task-types` | List task types. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows` | List or create flows. |
| `GET` / `PATCH` / `DELETE` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}` | Read, update, or delete a flow. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` | Validate a draft. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` | List or publish versions. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}` | Read one version. |
| `GET` / `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` | List or start executions. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}` | Read execution status. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/cancellations` | Cancel an execution. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/retries` | Retry an execution. |
| `POST` | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/signals/{signalName}` | Send a signal. |
| `GET` | `/v1/flows/workspaces/{workspaceId}/executions/{executionId}/events` | Stream execution events over SSE. |

See [Flows](/guide/flows) and [Workflow DSL Reference](/architecture/workflow-dsl-reference).

## MCP routes

MCP server hosting is Preview:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/mcp/workspaces/{workspaceId}/servers` | List or create MCP servers. |
| `GET` / `DELETE` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}` | Read or delete one server. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/curations` | Curate tool exposure. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions` | Publish a version. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/versions/{version}/approval` | Approve a held version. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls` | Invoke one tool through the control plane. |
| `POST` | `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc` | MCP JSON-RPC endpoint. |

Hosted MCP server pods are internal-only and use Knative.

## Errors

Errors use the closed `ErrorResponse` contract. The response header and body carry the same safe
correlation:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
X-Correlation-Id: corr-auth-0001

{
  "status": 401,
  "code": "GW_UNAUTHENTICATED",
  "message": "Authentication required",
  "detail": {},
  "requestId": "request-0001",
  "correlationId": "corr-auth-0001",
  "timestamp": "2026-08-08T12:00:00.000Z",
  "resource": { "path": "/v1/metrics/tenants/{id}/quotas" }
}
```

See the generated OpenAPI `components.schemas.ErrorResponse` and the
[public API surface error reference](https://github.com/gntik-ai/falcone/blob/codex-integration/docs/reference/architecture/public-api-surface.md#error-response-envelope)
for field and sanitization rules.

Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON, invalid query, or validation error. |
| `401` | Missing or invalid credential. |
| `403` | Authenticated but not allowed for the route or workspace. |
| `404` | Unknown or hidden resource. |
| `409` | Conflict with existing state. |
| `429` | Rate or quota limit. |
| `502` / `503` | Upstream platform dependency unavailable. |
