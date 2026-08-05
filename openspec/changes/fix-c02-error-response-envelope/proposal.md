# Change: Normalize both control-plane runtimes' JSON errors to the canonical ErrorResponse envelope

## Why

C-02 / ERR-CONTRACT-02 is a confirmed, reproduced (audit baseline `e3dc2592`) error-contract defect.
The public `ErrorResponse` schema — referenced by essentially every operation in
`apps/control-plane-executor/openapi/control-plane.openapi.json` — is a closed
(`additionalProperties: false`) object that requires `status`, `code` (pattern `^GW_[A-Z0-9_]+$`),
`message`, `detail` (`ErrorDetail`), `requestId` (8–128), `correlationId` (8–128, pattern
`^[A-Za-z0-9._:-]{8,128}$`), `timestamp` (`date-time`), and `resource` (`ErrorResource`, required
`path`), with an optional `retryable`. Both runtimes instead serialize the legacy `{ code, message }`
shape:

- `apps/control-plane/server.mjs` sends errors through a blind `sendJson(res, statusCode, body)` and
  hand-writes legacy bodies at every seam — `404 { code: 'NO_ROUTE', message: 'No action mapped for
  GET /v1/…' }`, `401 { code: 'UNAUTHENTICATED' | 'INVALID_TOKEN' }`, `403 { code: 'FORBIDDEN',
  message: 'requires ' + route.auth }`, the `400` body-parse result from
  `request-body.mjs::normalizeJsonBody` (`INVALID_JSON` / `VALIDATION_ERROR`), `500 { code:
  'NO_HANDLER' }`, and the top-level catch `{ code: statusCode >= 500 ? 'CONTROL_PLANE_ERROR' :
  err.code, message: statusCode >= 500 ? 'Internal server error' : code }`.
- `apps/control-plane-executor/src/runtime/server.mjs` likewise emits legacy bodies at each gate
  (`401 UNAUTHENTICATED`, several `403 FORBIDDEN`/`CROSS_TENANT_VIOLATION`/`INSUFFICIENT_SCOPE`,
  `404 WORKSPACE_NOT_FOUND`/`NO_ROUTE`) and in its central catch `{ code: err.code ??
  'CONTROL_PLANE_ERROR', message: statusCode >= 500 ? 'Internal server error' : err.message }`,
  additionally attaching top-level `errors` (flow validation) and `dimension` (quota) keys that the
  closed schema forbids.

Beyond the six missing required fields, three properties of the legacy shape are contract- and
safety-relevant. The `code` values (`NO_ROUTE`, `FORBIDDEN`, `CONTROL_PLANE_ERROR`, …) do not match
`^GW_[A-Z0-9_]+$`. Several messages leak authorization detail an adversary can use — the executor
`403 INSUFFICIENT_SCOPE` echoes the required `requiredScope`, the control-plane `403 FORBIDDEN` echoes
`requires <scope>`, and `404 WORKSPACE_NOT_FOUND` echoes the probed workspace id. And a `< 500`
executor error echoes the raw `err.message`, reflecting caller-influenced text back into the body.
The published SDK template
`packages/openapi-sdk-service/src/capability-modules/base-template.openapi.json` compounds the drift:
its `ErrorResponse` requires only `code`/`message`/`requestId`, so generated SDKs describe neither the
real envelope nor the `GW_` code discipline.

Site-reliability operators (P3) and machine/service API clients (P12) are the primary consumers of the
error contract: P3 needs a correlatable `requestId`/`correlationId` and `timestamp` on every failure —
especially a sanitized 5xx — to join a response to server logs without the server leaking internals,
and P12 needs a stable, typed, `additionalProperties`-closed envelope with a bounded `code` and
`retryable` to branch on programmatically. Privileged and adjacent human operators (P1 superadmin, P4
security/compliance, P7 workspace owner/admin, P9 workspace operator) consume the same envelope under
their existing authorization and gain no new grant. A scoped read-only viewer/auditor (P10) receives
the identical envelope shape on its permitted requests and no new capability. An actor from another
tenant (P13) is the adversarial control: normalization must disclose no authorization scope, role,
quota dimension, denial subtype, or identifier beyond the pre-existing HTTP status and addressed path.

## What Changes

- Serialize every non-streaming (buffered) JSON error from both runtimes as an `ErrorResponse` that
  validates exactly against the published closed schema — all eight required fields, correct types,
  the `GW_` `code` pattern, the `correlationId`/`requestId` length and pattern bounds, an RFC3339
  `timestamp`, a valid `ErrorResource`, and no disallowed top-level property — for the authentication
  (`401`), validation (`400`), forbidden (`403`), not-found (`404`), and sanitized server-error (`5xx`)
  classes, plus the `409`/`422`/`429`/`501` conditions both runtimes already produce.
- Introduce one shared pure normalization helper (`apps/shared/error-envelope.mjs`) and apply it at the
  single `sendJson` serialization chokepoint each runtime already funnels every error through, so every
  inline gate and both central catches conform without per-call-site edits and success responses keep
  their existing serialization.
- Set the top-level `code` to a value matching `^GW_[A-Z0-9_]+$`: preserve only explicitly approved,
  server-owned public classes and otherwise use a status-generic class. Every 403 collapses to
  `GW_FORBIDDEN`, and 5xx classes derive only from status, so a provider/datastore/caller value never
  becomes a public class token.
- Build `detail` from a bounded public-key allowlist, filtering strings that match the bounded denylist
  for stack, SQL/SQLSTATE, HTTP URLs, authentication/secret material, PostgreSQL, or MongoDB. Every 403
  is exactly `{ reason: 'FORBIDDEN' }` and every 5xx is `{}`. Public validation and status-view hints are
  preserved; producers remain responsible for not placing internal data in allowlisted public fields.
- Validate and, when absent or malformed, generate the identifiers: `requestId` and `correlationId` are
  taken from the request's `x-request-id`/`x-correlation-id` when they satisfy the id shape and are
  otherwise generated with `randomUUID()`; the `correlationId` is echoed in the body and equals the
  value the existing audit/metrics correlation uses when the client supplied one. Emit an RFC3339
  `timestamp`.
- Derive `resource` only from the request path the caller addressed: exclude query/fragment data and
  control characters, cap the pathname, and collapse recognized identifier-prefix, UUID, numeric,
  colon-delimited, and unusually long segments to `{id}`. Other opaque segments remain the caller's
  addressed path, so public clients must never put credentials or secrets in path segments. For the
  same addressed path, 403 and 404 responses carry the same `resource` value.
- Sanitize server messages: every public `message` is class-appropriate and free of authorization
  scope/role, secrets, SQL, stack, and unauthorized-existence claims; field-level specifics live in
  the allowlisted `detail.violations`. This removes the `requires <scope>`, `requiredScope`, and probed
  workspace-id leaks.
- Align the SDK base template's `ErrorResponse` (and its `ErrorDetail`/`ErrorResource`) to the
  canonical envelope so generated SDKs describe all fields and the `GW_` code discipline, without
  loosening the already-correct canonical `control-plane.openapi.json`.
- Keep the web console compatible: update the shared reader (`apps/web-console/src/lib/http.ts`) to
  retain the wire code in `gatewayCode`, expose the stripped class through its compatibility `code`,
  and fold `detail.errors`; update the config export/preflight/reprovision/schema and backup-operation
  clients that parse bodies directly. Preserve status-based copy, the 409 status-view funnel, and a
  rolling-rollback fallback for the legacy `{ code, message }` body.
- Add hermetic unit, black-box, and contract tests for the helper and both runtimes' classes, package the
  helper into both images (`apps/control-plane/Dockerfile` and `apps/control-plane-executor/Dockerfile`
  `COPY` `apps/shared/error-envelope.mjs`) with a packaging test, and document the envelope in
  `docs/reference/architecture/public-api-surface.md`. No cluster deployment is performed by this change.

## Personas and Observable Outcomes

- P3 (SRE) receives, on every failure including a sanitized 5xx, an envelope with a bounded `code`, a
  generated `requestId`, the propagated `correlationId`, and an RFC3339 `timestamp`, and no server
  internals — enough to correlate the response to server logs.
- P12 (machine/service client) receives a stable, `additionalProperties`-closed envelope with the eight
  required fields, a `GW_` `code` conveying the error class, a sanitized `detail`, a safe `resource`, and
  an optional `retryable`, and can branch on it deterministically across both runtimes.
- P1, P4, P7, and P9 receive the same conformant envelope under their existing authorization; the
  change grants none of them a new operation.
- P10 remains read-only: on its permitted requests it receives the identical envelope shape with no
  extra tenant, scope, or existence information and no mutation or side effect.
- P13 learns no authorization scope, role, quota dimension, denial subtype, or common identifier form
  from the normalized fields. Existing 403/404 status and resource-existence semantics are unchanged.
- Every persona's console renders the canonical envelope (and a temporarily legacy one) without
  crashing, showing the localized status-based copy and preserving the auth status-view funnel.

## Non-Goals

- No C-03 enforcement/response-header change and no gateway (APISIX) policy, plugin, or route change;
  the runtime-authored body is the source under repair and the gateway pass-through is unchanged.
- No C-08 route registration or catalog change; no new or removed route, method, operation id, status
  code, or rate-limit class.
- No authentication, authorization, role, permission, membership, scope-enforcement, or tenant/workspace
  isolation change; the normalization runs only after the existing boundary has already decided the
  status.
- No change to resource-existence semantics, to any success (`2xx`) schema or body, or to the canonical
  `control-plane.openapi.json` error schema (which is already correct).
- No rewrite of streaming/SSE/JSON-RPC error frames or of any error emitted after response headers are
  sent, and no rewrite of the executor's proxy pass-through of an upstream response (a C-08/gateway
  concern).
- No new persistence, audit event, metric, or quota side effect; no database migration; and no shared,
  staging, or production deployment or Helm/chart change.
- No remediation of any audit finding other than C-02.

## Exit Criteria

- Every buffered JSON error from `apps/control-plane/server.mjs` and
  `apps/control-plane-executor/src/runtime/server.mjs` — for `400`, `401`, `403`, `404`, and `5xx`, plus
  the existing `409`/`422`/`429`/`501` conditions — validates against `ErrorResponse` (required fields,
  types, the `GW_` `code` pattern, the id length/pattern bounds, RFC3339 `timestamp`, a valid
  `ErrorResource`, and no disallowed top-level property), verified by an Ajv contract test that also
  rejects the legacy `{ code, message }` shape.
- The top-level `code` matches `^GW_[A-Z0-9_]+$`, is derived deterministically from the response
  condition, is identical across both runtimes for equivalent conditions, and discloses no tenant id,
  scope/role value, dimension value, existence, or attacker text.
- `detail` uses only the bounded public-key allowlist; strings matching the bounded sensitive-marker
  denylist are removed; every 403 is `{ reason: 'FORBIDDEN' }`; every 5xx is `{}`; and public validation
  and status-view hints remain available without reflecting the source denial cause.
- `requestId` is generated within bounds; `correlationId` is propagated from a valid header or
  generated, appears in the body, and matches the value the existing audit/metrics correlation uses when
  the client supplied one; a missing/malformed incoming id is regenerated, never echoed; `timestamp` is
  RFC3339.
- `resource.path` is the addressed request pathname with query/fragment data and controls excluded,
  bounded to 512 characters, and recognized identifier forms redacted; opaque path segments remain, and
  the public contract documents that clients must never place credentials or secrets in path segments.
- The `403 requires <scope>` / `INSUFFICIENT_SCOPE requiredScope` / `404 WORKSPACE_NOT_FOUND <id>`
  body leaks are gone; equivalent response conditions across both runtimes normalize identically and
  the envelope introduces no new foreign-existence signal beyond the existing HTTP status semantics.
- The SDK base-template `ErrorResponse`/`ErrorDetail`/`ErrorResource` describe the canonical envelope
  and the `GW_` pattern; the canonical `control-plane.openapi.json` is unchanged; `npm run
  validate:openapi` and `npm run validate:public-api` pass with no unexpected drift.
- The console's updated shared reader and direct-body config/backup clients consume the canonical fields;
  the console renders canonical and legacy bodies without crashing; status-based copy and the `409`
  status-view funnel are unchanged; console unit tests pass.
- Existing authentication, authorization, isolation, routes, status codes, rate-limit classes, success
  bodies, streaming behavior, and the `recordHttp`/`recordRouteAudit`/`recordRouteDenial` audit/metrics
  side effects are preserved; the normalization emits no new event and runs once per response.
- Both images package the helper (`apps/shared/error-envelope.mjs` is `COPY`d into each); a
  packaging/import-resolution test passes; no cluster rollout is performed.
- Unit, black-box, contract, and console suites, existing auth/isolation regressions, markdownlint, and
  `git diff --check` pass, and `openspec validate fix-c02-error-response-envelope --strict` passes.

## Risks and Rollback

The primary safety risk is a normalized error re-introducing a disclosure — a scope/role in a message,
a probed id, a SQL fragment on a 5xx, or a query string in `resource.path`; the message-sanitization,
`detail`-sanitization, and path-only `resource` requirements plus dedicated P13 and 5xx tests across
both runtimes bound it. The primary compatibility risk is a console regression from the `GW_` code
prefix breaking a page-level `code` branch or the auth funnel; keeping the error class in the top-level
`GW_` code, updating the affected console clients, and the funnel's `detail`-first-then-substring
behavior bound it. The primary packaging risk is a runtime booting without the helper module
(`ERR_MODULE_NOT_FOUND`); the two `Dockerfile` `COPY`s, the packaging test, and a conformant path bound
it.

Rollback is a revert of the normalizer, both runtimes' error seams, the SDK template, the console
reader, the tests, and this OpenSpec change. It requires no data or datastore migration and introduces
no persisted state. Rollback reintroduces the C-02 legacy `{ code, message }` bodies and their leaks.
