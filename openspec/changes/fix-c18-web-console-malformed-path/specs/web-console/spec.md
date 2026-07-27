# web-console — spec delta for fix-c18-web-console-malformed-path

## ADDED Requirements

### Requirement: Malformed static paths are contained as request-local client errors

The system SHALL classify exact `/healthz` and raw `/v1` or `/v1/*` targets before static-path
processing; for every remaining request, it SHALL isolate the pathname from its query before
decoding, detect invalid or incomplete percent escapes and invalid encoded URI byte sequences, and
return a complete HTTP `400` response before any static file read or SPA fallback. The malformed
response SHALL be fixed, non-reflective, and non-sensitive, and the request SHALL NOT cause an
uncaught exception, unhandled rejection, connection reset, `5xx`, hang, process exit, listener
shutdown, or restart.

#### Scenario: Invalid or incomplete percent escape in a static pathname

- **WHEN** an HTTP client requests a static pathname such as `/%ZZ` or `/%`
- **THEN** the server completes the request with status `400`, does not serve a static file or the
  SPA fallback, does not reflect the request target, and keeps the current process and listener
  running

#### Scenario: Invalid encoded URI byte sequence in a static pathname

- **WHEN** an HTTP client requests a static pathname whose percent-encoded bytes do not form a
  valid URI sequence
- **THEN** the server completes the request with status `400` under the same fixed,
  non-reflective response contract and does not attempt static or SPA delivery

#### Scenario: Health classification remains first

- **WHEN** an HTTP client requests exact `/healthz`
- **THEN** the existing health branch responds with status `200` and body `ok` without entering
  static-path validation

### Requirement: Repeated malformed requests do not remove web-console availability

The system SHALL preserve the same web-console process and listener across sequential malformed
static requests. After at least two such requests, the same process identifier SHALL remain alive
and SHALL continue to serve health, root shell, valid static asset, SPA fallback, and same-origin
API proxy requests.

#### Scenario: Same-process recovery after sequential malformed requests

- **WHEN** the same child process receives two sequential malformed static requests, including an
  invalid percent escape and an invalid encoded URI byte sequence
- **THEN** both requests receive `400`, the child does not exit or restart, and its original PID
  subsequently serves `/healthz` as `200` with `ok`, `/`, a valid asset, a valid SPA route, and a
  representative `/v1` proxy request

#### Scenario: Malformed request does not trigger a delayed process failure

- **WHEN** a malformed static response has completed
- **THEN** the server emits no uncaught exception or unhandled rejection attributable to that
  request and its listener remains reachable for later requests

### Requirement: Valid static and SPA delivery remains compatible

The system SHALL preserve the existing behavior for valid percent-encoded static paths, existing
static assets, `/`, `/index.html`, valid client-side SPA routes, and request queries. Successful
static and SPA responses SHALL retain their current content, MIME handling, compression
negotiation, cache policy, and browser security headers. Percent syntax that is malformed only in
the query SHALL NOT cause the valid static pathname to be rejected.

#### Scenario: Valid percent-encoded static asset path

- **WHEN** a valid percent-encoded pathname resolves to an existing static asset
- **THEN** the server decodes and serves the asset under existing MIME, compression, cache, and
  security-header behavior

#### Scenario: Root, index, and valid SPA routes

- **WHEN** a client requests `/`, `/index.html`, or a valid client-side route with no matching
  static file
- **THEN** the server preserves the existing root/index delivery or `index.html` SPA fallback,
  including the current `no-store` and security headers

#### Scenario: Malformed percent syntax exists only in the query

- **WHEN** a valid static pathname or SPA route carries a query containing invalid or incomplete
  percent syntax
- **THEN** static-path validation ignores that query syntax and the pathname follows its existing
  static or SPA behavior

### Requirement: Raw same-origin API proxy precedence and compatibility remain unchanged

The system SHALL classify exact `/v1` and every raw `/v1/*` request before static-path validation,
including `/v1/%ZZ`, and SHALL let the upstream gateway decide the meaning of the raw target. The
proxy SHALL preserve the request method, raw path and query, headers, and body, and SHALL relay the
upstream status, headers, and body. An unreachable gateway SHALL retain the current HTTP `502`
JSON response with code `GATEWAY_UNREACHABLE`.

#### Scenario: Complete API proxy round trip

- **WHEN** a client sends a `/v1` or `/v1/*` request with a method, raw path and query, headers,
  and body and the gateway replies with its own status, headers, and body
- **THEN** the proxy forwards the complete request semantics and relays the complete upstream
  response semantics without static validation or SPA fallback

#### Scenario: Malformed percent syntax stays in the raw API branch

- **WHEN** a client requests `/v1/%ZZ`
- **THEN** the server forwards the raw target to the gateway rather than returning the static-path
  `400`, decoding the target, reading a file, or serving the SPA fallback

#### Scenario: Gateway remains unreachable

- **WHEN** a raw `/v1` proxy request cannot reach its configured gateway
- **THEN** the server retains the current `502` JSON behavior with code
  `GATEWAY_UNREACHABLE` and remains available for subsequent requests

### Requirement: Malformed-path handling preserves identity, isolation, and governance boundaries

The system SHALL apply the same bounded malformed-static-path behavior to unauthenticated clients
and all Falcone personas without adding or bypassing authentication or authorization. The response
SHALL NOT disclose the raw or decoded request target, filesystem paths, file or SPA contents,
stack traces, exception text, process environment, credentials, or tenant/workspace information.
The remediation SHALL NOT introduce tenant-scoped static assets, persistence, data mutation, quota
consumption or enforcement, audit events, metrics, or new logging contracts, and SHALL NOT change
gateway/backend ownership of authorization and tenant isolation for `/v1` requests.

#### Scenario: Unauthenticated malformed request discloses no sensitive data

- **WHEN** an unauthenticated external HTTP consumer (P11), including the adversarial
  shared-availability/leakage lens represented by P13, sends a malformed static pathname
- **THEN** the consumer receives the fixed `400` response without request reflection, internal
  runtime details, credentials, tenant/workspace data, static file content, or SPA content

#### Scenario: Persona and authorization non-regression

- **WHEN** platform operators (P3), release engineers (P18), constrained/read-only users (P4 and
  P10), or task-owning administrators and developers (P1, P7, and P9) use the console after this
  change
- **THEN** their existing capabilities and authorization boundaries are unchanged, while the
  shared console listener remains available after adversarial malformed requests

#### Scenario: Tenant and governance surfaces remain out of the static-path flow

- **WHEN** a malformed static request is contained
- **THEN** no tenant/workspace context, backend or persistent data, quota state, audit event, or
  metric is read or changed, and `/healthz` remains the existing process-health signal

### Requirement: Release and kind images retain one shared web-console runtime

The system SHALL keep `apps/web-console/static-server.mjs` as the shared runtime copied and run by
both `apps/web-console/Dockerfile` and `deploy/kind/web-console/Dockerfile`; the remediation SHALL
NOT add a divergent release, kind, or alternate-server implementation.

#### Scenario: Either existing web-console image is packaged

- **WHEN** the release Dockerfile or kind compatibility Dockerfile is used to package the console
- **THEN** it copies the shared static-server entrypoint and runs that entrypoint as the single
  Node command with the existing container defaults

### Requirement: Process-boundary regression proof is deterministic and local

The automated regression suite SHALL spawn the shared web-console runtime as a real child process
against a temporary static root, bind the console and mock gateway to ephemeral local ports, and
exercise malformed static handling, same-PID recovery, valid static and SPA compatibility, and raw
`/v1` proxy compatibility. The test SHALL NOT require fixed ports, Docker, an external network,
repository writes, or Kubernetes.

#### Scenario: Focused child-process regression suite runs

- **WHEN** a maintainer runs
  `node --test tests/unit/web-console-static-server.test.mjs`
- **THEN** the suite deterministically covers `/%ZZ`, `/%`, invalid encoded UTF-8, sequential
  malformed requests, same-PID post-error recovery, valid percent-encoded/static/SPA paths,
  query-only malformed syntax, and a local mock-gateway `/v1` round trip using only temporary
  resources and ephemeral ports

### Requirement: Static asset delivery reference documents malformed-path containment

The system SHALL document in
`docs/reference/architecture/web-console-static-asset-delivery.md` that malformed static
pathnames return `400`, never enter file or SPA fallback delivery, and do not terminate the shared
process, together with the focused local verification command.

#### Scenario: Operator or release engineer consults static delivery behavior

- **WHEN** a platform operator (P3), release engineer (P18), or documentation maintainer (P17)
  reads the web-console static asset delivery reference
- **THEN** the reference states the malformed-static-path boundary, process-preservation
  guarantee, `/v1` precedence, and
  `node --test tests/unit/web-console-static-server.test.mjs` verification command
