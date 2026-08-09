# Design: one enforced API version and one end-to-end correlation

## Context

C-03 confirmed a contract/runtime split. The canonical OpenAPI and taxonomy published
`X-API-Version: 2026-03-26` and `X-Correlation-Id`, while direct authenticated requests without either
header still succeeded. Neither public listener validated the version or guaranteed a response
correlation. The base gateway policy simultaneously marked correlation required and promised to generate
it when absent, the in-repo APISIX CORS render did not name or expose the trace headers, and the console's
native `EventSource` callers could not send them.

The existing shared C-02 error-envelope module is already packaged into both runtime images and owns
correlation validation/generation for error responses. Extending that boundary avoids introducing a
second correlation implementation or Docker packaging path.

## Goals

- Require the canonical API version on matched public `/v1` requests after authentication and before
  authorization/domain work.
- Treat external correlation as optional: preserve one valid supplied value, generate when absent, and
  reject malformed or ambiguous input without reflecting it.
- Return one resolved correlation on JSON success/error, proxy, and SSE handshake paths; keep C-02 error
  header/body values equal.
- Align canonical contracts, generated artifacts, gateway policy/CORS, both runtimes, first-party clients,
  SDK assembly, validators, tests, and documentation.
- Preserve authn/authz, tenant/workspace isolation, route existence, success bodies, SSE frames,
  observability cardinality, and all infrastructure exemptions.

## Non-goals

- No cluster deployment, sibling-chart edit, datastore migration, tracing backend, new audit event, new
  metric family/label, or persisted state.
- No role, permission, scope, route, method, operation, success-schema, C-02 envelope-schema, JSON-RPC,
  WebSocket-frame, or SSE-frame change.
- No remediation of any finding other than C-03.

## Decision 1: extend the shared C-02 boundary

`apps/shared/error-envelope.mjs` exports the canonical version plus two pure helpers:

- `resolveCorrelationId(value)` preserves a value matching `^[A-Za-z0-9._:-]{8,128}$`; otherwise it
  returns a UUID. The safe value is resolved before early error branches so an invalid inbound value is
  never reflected.
- `validatePublicRequestHeaders(headers)` distinguishes missing version, unsupported/ambiguous version,
  malformed/ambiguous correlation, and a valid request. Runtime codes are normalized by the existing C-02
  envelope to `GW_API_VERSION_REQUIRED`, `GW_UNSUPPORTED_API_VERSION`, and
  `GW_INVALID_CORRELATION_ID`.

Both listeners already import this shared module, so the change adds no packaging or image-copy seam.

## Decision 2: preserve security and routing order

The boundary resolves a safe correlation early, then applies decisions in this order for a matched public
route:

1. Existing unmatched-route handling remains `404`. Executor fall-through first matches method/path
   against the generated public route catalog, so only a published upstream operation enters the
   authentication and proxy boundary.
2. Executor `OPTIONS` uses `Access-Control-Request-Method` plus that catalog: a published preflight
   returns the CORS `204` locally without authentication/trace enforcement, while an unknown one remains
   `404` and never reaches the upstream.
3. Existing authentication runs; missing/invalid credentials remain `401` and do not reveal header
   validity.
4. API version is validated, then supplied correlation is validated.
5. The control-plane schema-readiness gate runs only after those decisions, followed by existing
   authorization, scope, tenant/workspace, existence, parsing, and domain handling.

`OPTIONS`, root, health/readiness/liveness, metrics, internal, and native paths retain their existing
exemptions. Trace headers never establish identity, scope, tenancy, or existence.

## Decision 3: one value across every response path

Both runtimes place the safe correlation in the existing response error context. Their JSON response
helpers set `X-Correlation-Id`, making C-02 error bodies and response headers agree without changing body
schemas. Executor SSE branches add the same header to the `200` handshake without modifying events.

The executor proxy forwards the resolved correlation and current API version, then forces that same
boundary-owned value on the client response even if the upstream omits or attempts to replace it.
Failures use the same safe value. This covers direct, forwarded, and `502` paths without minting a
second trace.

## Decision 4: canonical generation remains authoritative

The hand-maintained OpenAPI and taxonomy define:

- required `X-API-Version` pinned to `2026-03-26`;
- optional inbound `X-Correlation-Id`, generated when absent;
- `X-Correlation-Id` on every declared response;
- the three trace-header error codes.

The public API generator derives family OpenAPI documents, the route catalog, and the architecture
reference from those sources. Validators assert the optional-inbound/generated/returned semantics and
prevent a stale version or header-presence drift. The SDK assembler injects the shared request parameters
and response correlation into generated capability operations.

## Decision 5: gateway policy declares; runtimes enforce

The base gateway policy marks version required and correlation optional/generated/returned. The in-repo
APISIX route render documents `X-API-Version` and `X-Correlation-Id` but disables the route-local CORS
plugin for `/v1`: that plugin terminates preflight in the gateway rewrite phase and would bypass the
catalog-aware runtime decision. Both runtimes therefore own the executable CORS headers on JSON, proxy,
SSE, and preflight responses, expose `X-Correlation-Id` to browser callers, and advertise the complete
configured public allow-list, including API-key, SSE resume, conditional, and range headers. A browser
preflight carries requested header names but not the eventual `apikey` value, so dedicated, higher-priority
`OPTIONS` routes send the Postgres, Mongo, Events, and Functions families to the executor without the
API-key route's header-value condition. The executor then applies the canonical public route catalog:
published operations receive `204`; registered realtime and flow-monitoring SSE routes use the same
explicit local route registry; and unknown preflights remain `404`. The allow-list also includes the
public `X-Origin-Surface` contract, while the expose-list preserves correlation, idempotency/rate-limit,
and partial-content metadata declared by the base gateway/OpenAPI contracts. The contract does not
require a correlation value on an exempt preflight response.

The five in-repository routes with APISIX `limit-count` can return `429` before a listener runs. A rewrite
serverless function resolves a safe gateway correlation: one valid supplied value is preserved, omission
uses NGINX's safe request identifier and is forwarded, and malformed/duplicate input is left intact for
the runtime to reject but never selected for a gateway-owned response. A header-filter function keeps an
authoritative runtime response value and supplies the safe gateway value only when a short-circuiting
plugin emitted none. This preserves authentication/header-validation order on proxied requests while
closing correlation continuity on gateway-owned `429` responses.

No APISIX request-validation/serverless rule is added: rejecting at that layer would precede the runtime's
authentication decision or produce a non-C-02 error. The public runtimes are therefore the executable,
hermetically tested enforcement boundary; the gateway declaration and CORS render remain aligned defense
in depth. The sibling production chart and any rollout are explicitly outside this change.

## Decision 6: one first-party transport boundary, including streams

The JSON client continues to send the version and a per-request correlation and now offers returned
correlation metadata to its session caller. A shared `publicApiFetch` applies the same headers to callers
that need a raw `Response` (downloads, `207`/`304`, and SSE), including the Kafka topic stream and the
configuration, backup, capability-catalog, SDK-download, and secret-rotation clients. The SDK capability
lookup, hosted MCP runtime, executor platform-MCP bridge, legacy backup-audit client, and published
function snippets also send both headers. Contract tests inventory these first-party seams and prevent a
new direct `/v1` fetch from bypassing the boundary.

The two native `EventSource` sites migrate to a shared `fetch`/`ReadableStream` adapter because browser
`EventSource` cannot set request headers.

The adapter preserves named events, `id`, fragmented and CRLF frames, `retry`, `Last-Event-ID`
reconnection, terminal events, and abort-based cancellation. Trace values stay in headers. Existing
`?apikey=` authentication remains for compatibility and is not broadened to trace query parameters.

## Decision 7: no new telemetry surface

The change adds no audit event, metric, or label. Existing audit/metrics code receives only the resolved
safe correlation. Header rejections happen before adapters/datastores/providers and cannot cause a domain
mutation. Tests assert no handler/database work for rejected inputs and no reflection of hostile values.

## Rollout and rollback

This PR is code/config/contract-only and deliberately has `live=not-run`. First-party console and SDK
callers are updated in the same branch, but unknown external clients that omit the now-enforced version
must add `X-API-Version: 2026-03-26` before deployment. A separate authorized chart/cluster rollout must
coordinate that compatibility boundary.

Rollback reverts the contracts/generated artifacts, gateway declaration/CORS, runtime boundary, clients,
tests, docs, and this change together. No data rollback is required.

## Risks

- Strict version enforcement can reject permissive external clients; documentation and an ordered future
  rollout are required.
- A mixed gateway/runtime rollout can lose continuity; proxy and response-header tests constrain it.
- Fetch-based SSE can regress reconnect/cancel behavior; focused parser/service/hook tests cover it.
- The external chart can drift from this repository; it remains an explicit follow-up and no live
  remediation is claimed here.
