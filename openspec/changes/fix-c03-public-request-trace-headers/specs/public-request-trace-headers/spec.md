# public-request-trace-headers — spec delta for fix-c03-public-request-trace-headers

## Purpose

Defines the externally observable API-version validation and end-to-end request-correlation contract for
every Falcone public `/v1` request across first-party clients, the gateway, both runtimes, C-02 error
responses, and streaming handshakes — making the already-published trace-header contract real, internally
consistent, and enforced without preceding or weakening the existing authentication, authorization, and
isolation boundaries.

## ADDED Requirements

### Requirement: Published operations enforce the canonical API version

Every matched, non-exempt, published `/v1` operation on both the control-plane runtime
(`apps/control-plane/server.mjs`) and the executor runtime
(`apps/control-plane-executor/src/runtime/server.mjs`) SHALL require exactly one `X-API-Version` equal to
the canonical current value `2026-03-26`. After the request has passed the existing authentication
decision (or on a matched route that requires none), a missing or empty value SHALL return
`400 GW_API_VERSION_REQUIRED` and any other value — including a stale value or a duplicated/comma-combined
value — SHALL return `400 GW_UNSUPPORTED_API_VERSION`. The rejection SHALL be a canonical C-02
`ErrorResponse`, SHALL NOT reflect the supplied value, and SHALL occur before any handler, adapter,
database, or provider work. First-party internal calls SHALL send the current version (no stale default).

#### Scenario: Current version reaches the existing handler

- **WHEN** an authenticated, authorized caller supplies `X-API-Version: 2026-03-26` on a matched published
  operation
- **THEN** the request reaches the same authorization and domain behavior with unchanged success-body
  semantics

#### Scenario: Missing version is rejected without domain work

- **WHEN** an authenticated, authorized caller omits `X-API-Version` on a matched published operation
- **THEN** the response is `400 GW_API_VERSION_REQUIRED` as a canonical `ErrorResponse` and no handler,
  adapter, database, or provider work occurs

#### Scenario: Unsupported or ambiguous version is rejected

- **WHEN** an authenticated, authorized caller supplies a stale, unknown, duplicated, or comma-combined
  `X-API-Version`
- **THEN** the response is `400 GW_UNSUPPORTED_API_VERSION` and the supplied value is not reflected in the
  body, header, logs, audit, or metrics

### Requirement: The edge resolves exactly one safe correlation identifier

`X-Correlation-Id` SHALL be optional at the external client boundary and present as exactly one valid
value after public-runtime boundary processing. The system SHALL generate a value matching
`^[A-Za-z0-9._:-]{8,128}$` when
the header is absent, SHALL preserve exactly one valid supplied value unchanged, and SHALL reject an
empty, duplicated/comma-combined, or otherwise pattern-invalid supplied value with
`400 GW_INVALID_CORRELATION_ID` after successful authentication. A malformed or duplicated supplied value
SHALL never be reflected, returned, logged, recorded in audit or metrics, or propagated downstream; a
rejection response SHALL carry a newly generated safe correlation instead.

#### Scenario: Valid caller correlation is preserved

- **WHEN** an authorized caller supplies exactly one valid `X-Correlation-Id`
- **THEN** that exact value is used through the gateway, runtime, downstream/proxied requests, the existing
  audit/metrics linkage, and the response

#### Scenario: Missing correlation is generated

- **WHEN** an authorized caller supplies the current `X-API-Version` but no `X-Correlation-Id`
- **THEN** the public boundary generates exactly one conforming identifier, the request proceeds, and that identifier
  is the value carried downstream and returned

#### Scenario: Malformed correlation is rejected with a safe value

- **WHEN** an authenticated caller supplies a malformed or duplicated `X-Correlation-Id`
- **THEN** the response is `400 GW_INVALID_CORRELATION_ID` whose correlation is a freshly generated safe
  value, and the malformed/duplicated input appears nowhere in the response, logs, audit, metrics, or any
  downstream request

### Requirement: Every public response returns one correlation, and error header equals body

Every in-scope HTTP response SHALL include exactly one `X-Correlation-Id` header — on success, on header
validation `400`, on authentication `401`, authorization `403`, not-found `404`, throttling, and upstream
failure, and on a successful SSE/stream/upgrade handshake — equal to the request's resolved correlation
(or, for a malformed rejection, the freshly generated safe value). For a C-02 `ErrorResponse` the
response header SHALL equal the body `correlationId`. Success bodies and all protocol frames SHALL remain
unchanged. The executor proxy pass-through and any retry SHALL forward and return the one resolved
identifier rather than generate another.

#### Scenario: Success echoes the caller correlation

- **WHEN** a successful request supplies a valid `X-Correlation-Id`
- **THEN** the response includes the identical `X-Correlation-Id` header and the success body is unchanged

#### Scenario: Generated correlation is returned

- **WHEN** a successful request omitted `X-Correlation-Id` at ingress
- **THEN** the response returns the one generated identifier in the `X-Correlation-Id` header

#### Scenario: Error header and body agree

- **WHEN** an in-scope JSON request returns any `4xx` or `5xx` C-02 error
- **THEN** the `X-Correlation-Id` response header and the `ErrorResponse.correlationId` body field contain
  the same valid value

#### Scenario: Proxy and stream paths preserve one identifier

- **WHEN** the executor proxies a request to the control-plane upstream or opens a successful SSE/upgrade
  handshake
- **THEN** the forwarded request and the client response/handshake carry the same resolved
  `X-Correlation-Id`, no second identifier is generated, and no SSE/JSON-RPC/WebSocket frame is changed

### Requirement: Header processing preserves authentication and isolation boundaries

Anonymous `OPTIONS` preflight and the infrastructure paths `/health`, `/healthz`, `/readyz`, `/livez`,
`/metrics`, `/internal/*`, and `/_native/*` SHALL be exempt from version enforcement and correlation
rejection and SHALL continue to function unchanged. For a matched protected route, authentication SHALL
precede trace-header rejection: a missing or invalid credential SHALL keep the existing `401` and receive
a safe correlation, never a `400` trace-header error; an unmatched route SHALL keep its `404`. After valid
trace headers, existing authorization, tenant/workspace scoping, foreign-versus-unknown non-enumeration,
and handler-validation ordering SHALL remain unchanged.
Neither `X-API-Version` nor `X-Correlation-Id` SHALL establish or widen identity, scope, or existence.

#### Scenario: Authentication retains precedence

- **WHEN** a protected matched request has no valid credential and also has a missing or malformed trace
  header
- **THEN** it receives the existing `401` with a safe response correlation and discloses nothing about
  header validity or the target

#### Scenario: Unmatched route keeps not-found ordering

- **WHEN** a request addresses an unmatched route
- **THEN** it receives the existing `404` (before any trace-header rejection) with a safe correlation and
  no new existence signal

#### Scenario: Constrained and machine callers gain no scope

- **WHEN** a constrained read-only consumer (P11) or an adjacent/adversarial machine consumer (P12)
  supplies valid trace headers while addressing a foreign tenant or workspace
- **THEN** the existing opaque authorization/existence outcome is unchanged and the trace headers grant no
  additional scope, tenant, role, or existence information

#### Scenario: Preflight remains anonymous

- **WHEN** a browser sends `OPTIONS` without credentials, API version, or correlation
- **THEN** preflight succeeds under the existing CORS policy, which advertises `X-API-Version` and
  `X-Correlation-Id` as allowed request headers and `X-Correlation-Id` as an exposed response header

#### Scenario: API-key family preflight reaches the catalog-aware executor

- **WHEN** a browser preflights a published Postgres, Mongo, Events, or Functions operation and names
  `apikey`, `X-API-Version`, `X-Correlation-Id`, or `Last-Event-ID` in
  `Access-Control-Request-Headers` without sending the eventual API-key value
- **THEN** the configured gateway selects the executor preflight boundary without requiring an
  `http_apikey` match, the executor returns a successful route-aware preflight, and the response
  advertises every configured public request header while an unpublished operation remains `404`

#### Scenario: Header-capable streams pass route-aware preflight

- **WHEN** the console preflights a registered realtime change stream or flow-monitoring stream with
  trace headers and optional `Last-Event-ID`
- **THEN** APISIX selects the executor, the executor recognizes the registered local SSE route and
  returns successful anonymous preflight, and an unregistered stream path remains `404`

#### Scenario: Gateway-owned rate rejection returns safe correlation

- **WHEN** APISIX rate limiting rejects a public API-key or realtime request before either runtime runs
- **THEN** the `429` response contains one valid supplied correlation or a generated safe correlation,
  and malformed or duplicate client input is never reflected in that response

### Requirement: Canonical contract, generated artifacts, runtimes, and clients agree

The canonical OpenAPI (`apps/control-plane-executor/openapi/control-plane.openapi.json`) SHALL keep
`X-API-Version` required and pinned to `2026-03-26`, describe external `X-Correlation-Id` as optional,
declare an `X-Correlation-Id` response header on in-scope operations, and register
`GW_API_VERSION_REQUIRED`, `GW_UNSUPPORTED_API_VERSION`, and `GW_INVALID_CORRELATION_ID`. The taxonomy,
the generated family contracts, the generated public route catalog (with `correlationIdRequired: false`,
`correlationIdGeneratedWhenMissing: true`, and no `X-Correlation-Id` in `requiredHeaders`), the
`/v1/platform/route-catalog` discovery surface, and the SDK base template SHALL be regenerated/aligned to
the same rules and codes with no generator drift. Both runtimes SHALL enforce compatible behavior with the
in-repo gateway/APISIX/CORS configuration as defense in depth, and every first-party call SHALL send the
current version and a valid correlation and expose the returned value without placing either in a URL.
Validators SHALL prevent drift of these semantics.

#### Scenario: Generated artifacts are coherent

- **WHEN** the public API artifacts and the discovery catalog are regenerated and validated
- **THEN** the version and external-optional/internal-mandatory correlation semantics match the canonical
  taxonomy and gateway policy with no generator diff, and `validate:openapi`, `validate:public-api`, and
  `validate:gateway-policy` pass under the updated (non-drifting) checks

#### Scenario: Both runtimes make the same decision

- **WHEN** equivalent requests exercise registered control-plane and executor routes directly
- **THEN** both runtimes produce the same version, correlation, error-code, and response-header outcomes

#### Scenario: The published contract is machine-constructible

- **WHEN** an adjacent machine consumer (P12) follows only the canonical contract and route catalog
- **THEN** it can construct a compliant request, branch deterministically on the three `GW_` codes, and
  read the returned `X-Correlation-Id`

### Requirement: Browser and machine streams use a safe, compatible transport

Because a browser `EventSource` cannot set request headers, first-party console streams SHALL use a
header-capable transport (`fetch`/`ReadableStream`) that sends `X-API-Version` and one `X-Correlation-Id`,
preserves the existing named-event framing, `Last-Event-ID` reconnection, terminal events, and
cancellation, and keeps both trace values out of the URL. Existing API-key query authentication MAY remain
for compatibility, but trace metadata SHALL NOT be added to the URL.

#### Scenario: First-party streams send headers

- **WHEN** the console subscribes to a realtime change stream or a Flow-execution event stream
- **THEN** it sends `X-API-Version: 2026-03-26` and one `X-Correlation-Id` via a header-capable request,
  the handshake returns `X-Correlation-Id`, named events and cancellation behave as before, and neither
  trace value appears in the URL

### Requirement: Trace headers create no new sensitive telemetry

The change SHALL create no new domain mutation, success audit event, metric family, or metric label, and
SHALL NOT add correlation, version, credential, tenant, or workspace values as new metric labels. The
existing audit/metrics correlation linkage SHALL use only the safe resolved correlation and SHALL equal
the returned `X-Correlation-Id` and the C-02 body `correlationId`. Request telemetry SHALL record each
request once with its existing bounded route/status labels.

#### Scenario: Header rejection is telemetry-safe

- **WHEN** a request is rejected for a version or correlation header
- **THEN** no domain mutation occurs, the raw supplied values are absent from all audit, metric, and log
  outputs, and request telemetry keeps its bounded route/status cardinality

#### Scenario: Correlation linkage is consistent

- **WHEN** an in-scope request is recorded by the existing audit/metrics instrumentation
- **THEN** the recorded correlation equals the returned `X-Correlation-Id` header and, for an error, the
  `ErrorResponse.correlationId` body value

### Requirement: Public and operator documentation explains trace behavior

The documentation SHALL explain, for constrained (P11) and machine (P12) API consumers, the mandatory
current `X-API-Version`, the optional/generated `X-Correlation-Id`, the three validation error codes, the
authentication precedence, the CORS visibility, the header-capable stream transport, and safe retry use;
and, for platform/SRE (P3) and workspace (P9)
operators, how to retain the returned correlation for diagnosis without exposing credentials or tenant
data. It SHALL state that repository-only validation is not a live rollout.

#### Scenario: A contract-only consumer can construct a compliant request

- **WHEN** a P11 or P12 consumer follows only the public API documentation
- **THEN** the consumer can send a compliant request, handle each of the three header error codes, and
  retain the returned `X-Correlation-Id` for support correlation

#### Scenario: An operator can correlate a response to logs

- **WHEN** a P3 or P9 operator observes a client-side failure, including a sanitized `5xx`
- **THEN** the documentation shows how to read the returned `X-Correlation-Id` and join the response to
  server logs, audit, and metrics without exposing credentials or tenant data
