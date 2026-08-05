# Design: One canonical ErrorResponse envelope for both control-plane runtimes

## Context

The public error schema is closed and strict. In
`apps/control-plane-executor/openapi/control-plane.openapi.json`, `ErrorResponse` is
`additionalProperties: false` and requires `status` (integer 400–599), `code`
(`^GW_[A-Z0-9_]+$`), `message`, `detail` (`ErrorDetail`), `requestId` (8–128), `correlationId`
(8–128, `^[A-Za-z0-9._:-]{8,128}$`), `timestamp` (`date-time`), and `resource` (`ErrorResource`),
with an optional `retryable`. `ErrorDetail` is an open object with `reason` (string) and `violations`
(string array). `ErrorResource` is closed with a required `path` and optional `type`/`id`. Nearly every
operation references `ErrorResponse` for its error responses.

Both runtimes emitted the legacy `{ code, message }` shape from many independent seams, all of which
funnel through one serialization function per runtime:

| Runtime | File | Serialization chokepoint | Legacy seams that flow through it |
| --- | --- | --- | --- |
| Control-plane | `apps/control-plane/server.mjs` | `sendJson(res, statusCode, body)` (`~149`) | `404 NO_ROUTE`, `401 INVALID_TOKEN`/`UNAUTHENTICATED`, `403 FORBIDDEN` (echoes `requires <scope>`), the `400` `normalizeJsonBody` result, `500 NO_HANDLER`, and the central catch (`~459`) |
| Executor | `apps/control-plane-executor/src/runtime/server.mjs` | `sendJson(res, statusCode, body, headers)` (`~30`) | `401 UNAUTHENTICATED`, the `403 FORBIDDEN`/`CROSS_TENANT_VIOLATION`/`INSUFFICIENT_SCOPE` gates (echoes `requiredScope`), `404 WORKSPACE_NOT_FOUND` (echoes the id)/`NO_ROUTE`, the `501 *_DISABLED` gates, and the central catch (`~1304`) that additionally attached top-level `errors`/`dimension` |

Ordinary buffered errors pass through the single `sendJson` per runtime, so normalization is applied
there once rather than at dozens of call sites. The two streaming handlers that can reject before
opening a stream delegate those pre-header JSON failures to the same seam. Protocol frames written
after a stream opens, JSON-RPC/MCP frames, and the executor's upstream **proxy pass-through**
(`res.writeHead` on the upstream response) remain untouched. Both runtimes already compute a per-request
correlation id from `x-correlation-id` and a `normalizeRoute(pathname)` for metrics. The web console's
shared reader models most envelope fields but previously treated the wire `code` as its legacy domain
class and ignored nested `detail.errors`; several config/backup clients parse error bodies directly.
`describeConsoleError` keys off `status` only, and the `409` auth funnel reads `detail.statusView` first
and falls back to `code` substrings.

## Goals

- Make every buffered JSON error from both runtimes validate exactly against the closed `ErrorResponse`
  schema — the eight required fields, the `GW_` `code` pattern, the id length/pattern bounds, an RFC3339
  `timestamp`, a valid `ErrorResource`, and no disallowed top-level property.
- Normalize once, at the single `sendJson` chokepoint per runtime, from one shared pure helper, so the
  two runtimes are behaviorally identical for equivalent conditions and no per-call-site edit is needed.
- Never disclose an authorization scope, role, credential scope, denial subtype, secret, SQL, stack, or
  connection URL through code/message or 403/5xx detail, and add no new foreign-existence signal.
- Validate and generate identifiers; propagate the correlation value in the body; emit an RFC3339
  timestamp; derive a safe resource from the request path only.
- Keep the console working with the smallest surface change; keep success bodies, streaming behavior,
  routes, status codes, authorization, and existing audit/metric side effects unchanged; align the SDK
  template without touching the canonical OpenAPI.

## Non-Goals

- The C-03 response headers/enforcement, C-08 route registration, any gateway/APISIX change, and the
  proxy pass-through of an upstream response body.
- Any authorization/role/permission/membership/isolation change; any success-schema change; any edit to
  the canonical `control-plane.openapi.json` error schema (already correct).
- Any streaming/SSE/JSON-RPC rewrite or post-header second response; any new persistence, audit event,
  metric, or quota side effect; any migration or deployment.

## Decision 1: One shared pure helper, invoked at the single `sendJson` seam

`apps/shared/error-envelope.mjs` exports the pure `normalizeErrorResponse(statusCode, input, context)`,
which returns a fully-populated, schema-valid `ErrorResponse`. It performs no I/O and reads no ambient
request state — only its arguments — so it is unit-testable in isolation and identical for both runtimes.

Both runtimes' `sendJson` are changed to normalize when the response is an error and to leave successes
untouched:

- When `statusCode >= 400`, the body is replaced by `normalizeErrorResponse(statusCode, body,
  res._errorContext)` before serialization; when `statusCode < 400`, the existing success serialization
  is unchanged.
- Each runtime sets `res._errorContext = { requestId: <x-request-id>, correlationId: <x-correlation-id>,
  resource: <url.pathname> }` early in the request lifecycle (before routing/auth), so the context is
  available no matter which seam ultimately emits the error.

This routes every inline gate, both central catches, and buffered pre-stream failures through one
normalizer, while structurally excluding protocol frames and the proxy pass-through.

## Decision 2: Bounded `GW_` code derived from the response condition

`normalizeErrorResponse` retains only an explicitly approved server-owned public class, otherwise
selects a status-generic class, ensures a single `GW_` prefix, and bounds the length. Every `403`
collapses to `GW_FORBIDDEN`; `5xx` codes are selected by status and never from an exception/provider
code. The result
always matches `^GW_[A-Z0-9_]+$` (for example `NO_ROUTE` → `GW_NO_ROUTE`, while a 500 becomes
`GW_CONTROL_PLANE_ERROR`). The derivation is deterministic and a pure function of the response condition,
which keeps machine clients that
branch on the class working. The code carries only the class token — never a tenant id, an authorization
scope or role **value**, a quota dimension value, a secret, or attacker-controlled free text.

## Decision 3: Public, sanitized message

The `message` is selected only from fixed status-class text for every 4xx and 5xx. Handler, exception,
provider, and caller messages never cross the boundary. Field-level validation specifics may be carried
only by bounded allowlisted `detail` content.

## Decision 4: Sanitized `detail` with public field-level information only

`detail` is built from the source `detail`/`errors`/`dimension` and reduced to a bounded public-key
allowlist with bounded depth, collection length, and string length:

- a `4xx` validation `errors` array becomes `detail.violations`, a bounded list of public field-level
  strings with any denylisted string removed;
- a public `detail.reason` string is carried through when it does not match the bounded sensitive-marker
  denylist; every 403 instead becomes exactly `{ reason: 'FORBIDDEN' }`;
- a `5xx` `detail` is empty (`{}`), carrying no server-internal diagnostic;
- object keys outside the allowlist are dropped; strings matching stack, SQL/SQLSTATE, HTTP URL,
  authentication/secret, PostgreSQL, or MongoDB markers are dropped. This bounded filter is defense in
  depth, not general data-loss prevention, so producers must not put internal data in public fields.

Where a handler supplies a structured hint the console depends on (for example an auth status-view hint),
the design preserves it as public `detail` so the funnel keeps working; because `ErrorDetail` is open,
these public keys validate.

## Decision 5: Validated, generated identifiers and an RFC3339 timestamp

`requestId` and `correlationId` are taken from `res._errorContext` (the request's `x-request-id` and
`x-correlation-id`) when they satisfy their respective shapes. A request id starts alphanumeric and has
8–128 `[A-Za-z0-9._:-]` characters; a correlation id has 8–128 of those characters and may start with
`.`, `-`, `_`, or `:`. Invalid values are generated with `randomUUID()`, which conforms. The correlation
value is thus echoed in the body and, when the client supplied it, is the same value the existing
audit/metrics correlation uses. A missing or malformed incoming id is regenerated, never reflected, so
attacker-controlled text cannot land in the envelope. `timestamp` is `new Date().toISOString()`, an
RFC3339 `date-time`.

## Decision 6: Safe `resource` from the request path only

`resource.path` is derived from `res._errorContext.resource`, which is the request `url.pathname` — the
path the caller addressed, with the query string excluded (so an `?apikey=` or other query secret never
appears). Control characters are removed and the path is capped at 512 characters. Segments using a
recognized identifier prefix, UUIDs, numeric values, colon-delimited values, and segments longer than
64 characters collapse to `{id}`; other opaque path segments remain unchanged. Clients must never place
credentials or secrets in a path segment. The path is the caller's addressed input and asserts no
server-side existence; a `403` and a `404` for that same path therefore have the same `resource`.

## Decision 7: Minimal, compatible web-console change

The shared `http.ts` reader is updated to retain the canonical wire class as `gatewayCode`, expose the
`GW_`-stripped compatibility class as `code`, and fold nested `detail.errors` into `errors` while still
accepting a legacy body. Config export, preflight, reprovision, schema, and backup-operation clients that
parse error bodies directly now prefer canonical `message` and wire `code`. The `409` auth status-view funnel
continues to work: it reads `detail.statusView` first and otherwise matches `code` substrings, and the
`GW_`-prefixed class codes still contain those substrings. Because the reader falls back to
`HTTP_<status>`, a console talking to an older, still-legacy deployment keeps rendering. No page redesign,
navigation, copy, or route change is introduced.

## Decision 8: SDK/OpenAPI template alignment without loosening the canonical schema

`packages/openapi-sdk-service/src/capability-modules/base-template.openapi.json` `ErrorResponse` is
rewritten to `additionalProperties: false` with the eight required fields, the `GW_` `code` pattern, the
`requestId`/`correlationId` bounds, the RFC3339 `timestamp`, and `$ref`s to newly added
`ErrorDetail`/`ErrorResource` schemas — matching the canonical envelope. The canonical
`control-plane.openapi.json` is not edited; it is already correct and is the conformance oracle. `npm run
validate:openapi` and `npm run validate:public-api` confirm no unintended drift.

## Decision 9: No new audit/metrics side effect, success and streaming untouched

Normalization is response-shaping at the shared `sendJson` seam and emits no new audit event and no new metric. The
existing `recordHttp` labels, the enforcement-denial audit (`recordRouteDenial`), and the
mutating-action audit (`recordRouteAudit`) are unchanged, and the body `correlationId` equals the value
they record when the client supplied one. Normalization runs exactly once per response (the `>= 400`
guard, applied at the shared seam). Success (`< 400`) bodies and their schemas are untouched. Buffered
JSON failures before a stream opens use the seam; SSE/streaming and JSON-RPC frames, any post-`writeHead`
write, and the proxy pass-through of an upstream response are never routed through the normalizer.

## Decision 10: Packaging and hermetic tests

Both images `COPY` the shared helper — `apps/control-plane/Dockerfile` copies
`apps/shared/error-envelope.mjs` and `apps/control-plane-executor/Dockerfile` copies it into the
executor tree — so neither runtime boots with `ERR_MODULE_NOT_FOUND`;
`tests/unit/error-envelope-packaging.test.mjs` guards the `COPY` coverage and import resolution. The
behavior is proven by hermetic tests with no network, Docker, credential, fixed port, or cluster:

- `tests/unit/error-envelope.test.mjs` — the pure helper: `GW_` code derivation, `5xx` generic message
  and empty detail, secret/SQL/URL sanitization, id validation/regeneration, `violations` from an errors
  array, and the safe resource.
- `tests/blackbox/error-envelope-http-contract.test.mjs` — the real executor HTTP server: `404` and
  `401` bodies satisfy the envelope shape (status, `GW_` code, object `detail`/`resource`, bounded
  `requestId`/`correlationId`, RFC3339 `timestamp`), a short incoming id is regenerated, and a `200`
  success body is unchanged.
- `tests/contracts/error-envelope.contract.test.mjs` — Ajv conformance against the canonical
  `ErrorResponse`/`ErrorDetail`/`ErrorResource`, rejecting the legacy shape.

The suite is extended to assert, across both runtimes, the P13 no-leak properties (no scope/role value
or denial subtype, common identifier redaction, and equal resource values for the same addressed path)
and the cross-runtime parity of equivalent errors.

## Documentation

`docs/reference/architecture/public-api-surface.md` documents the canonical envelope, the `GW_` `code`
derivation, the sanitized message/detail rules, the id/correlation and timestamp behavior, the safe
resource derivation, the `5xx` sanitization guarantee, and the console-compatibility/legacy tolerance,
with a machine-client migration note (read the `GW_` class from `code`, use `requestId`/`correlationId`
for support correlation, and expect the closed envelope). No audit evidence, loop-state, credentials, or
deployment instructions are added.

## Rollout and Compatibility

The change is code-only: the shared helper, both runtimes' `sendJson`, both Dockerfiles, the SDK
template, the shared console reader and five direct-body config/backup clients, the tests, the generated
doc and its generator, and this OpenSpec change. It ships without a
schema, datastore, or data migration and adds no persisted state, so producer and consumer release
together. The console already tolerates missing fields and legacy bodies, so a mixed-version deployment
keeps rendering. Rollback reverts these files and reintroduces the C-02 legacy bodies and leaks.

## Risks

- **Disclosure regression:** a message still embedding a scope/role/probed id, or a detail slipping a
  secret; bound by the message/detail guarantees, the denylist, and dedicated P13/5xx tests across both
  runtimes.
- **Console regression:** a page-level `code` branch or the auth funnel breaking under the `GW_` prefix;
  bound by preserving the class token at top level, the funnel's `detail`-first-then-substring behavior,
  the reader's legacy fallback, and the updated clients.
- **Packaging gap:** an image missing the helper; bound by both `Dockerfile` `COPY`s and the packaging
  test.
- **Double response / wrong path:** normalizing a streaming or proxy write; bound by applying
  normalization only inside `sendJson` at the `>= 400` guard.
- **Schema drift:** loosening the canonical schema; bound by editing only the SDK template and asserting
  the canonical OpenAPI is unchanged.

## Open Questions

None. C-03 response headers, C-08 route registration, gateway policy, success schemas, resource
existence, streaming transports, and any deployment remain assigned to other findings or later work.
