# error-response-envelope — spec delta for fix-c02-error-response-envelope

## ADDED Requirements

### Requirement: Both runtimes emit the canonical ErrorResponse envelope for buffered JSON errors

The system SHALL serialize every non-streaming (buffered) JSON error from both the control-plane runtime
(`apps/control-plane/server.mjs`) and the executor runtime
(`apps/control-plane-executor/src/runtime/server.mjs`) as an `ErrorResponse` that validates exactly
against the published closed schema — the required `status`, `code`, `message`, `detail`, `requestId`,
`correlationId`, `timestamp`, and `resource`, correct types, the `code` pattern `^GW_[A-Z0-9_]+$`, the
`requestId`/`correlationId` length and pattern bounds, an RFC3339 `date-time` `timestamp`, a valid
`ErrorResource`, and `additionalProperties: false` at the top level. It SHALL NOT emit the legacy
`{ code, message }` shape, add a disallowed top-level property, or loosen the canonical OpenAPI schema.

#### Scenario: Authentication failure conforms

- **WHEN** an unauthenticated or invalid-token request reaches a protected JSON endpoint on either
  runtime
- **THEN** the status is `401`, the body validates against `ErrorResponse` with a `GW_`-prefixed `code`,
  and it discloses no credential, token, scope, or role value

#### Scenario: Validation failure conforms

- **WHEN** an authenticated client submits a malformed body or query (unparseable JSON, a non-object
  body, or an invalid query parameter)
- **THEN** the status is `400`, the body validates against `ErrorResponse`, and field-level specifics
  appear only in the allowlisted `detail.violations` while all required envelope fields are present

#### Scenario: Forbidden request conforms

- **WHEN** an authenticated principal lacks permission for an otherwise valid operation on either
  runtime
- **THEN** the status is `403` and the body validates against `ErrorResponse` with the `GW_FORBIDDEN`
  class code

#### Scenario: Not-found conforms

- **WHEN** a request references an unmatched route or a resource the caller may address but that is not
  present
- **THEN** the status is `404` and the body validates against `ErrorResponse` with a safe `resource`
  derived only from the request path

#### Scenario: Server failure conforms and is sanitized

- **WHEN** an unexpected exception, database error, or other internal fault is caught by either
  runtime's central catch
- **THEN** the status is the mapped `5xx`, the body validates against `ErrorResponse`, the public
  `message` is generic, and neither `message` nor `detail` contains a stack trace, exception message,
  SQL/SQLSTATE, connection URL, header, token, credential, or secret

#### Scenario: Legacy shape is rejected by the contract test

- **WHEN** a legacy `{ code, message }` body (or one missing any required field, or with a non-`GW_`
  code) is validated against `ErrorResponse`
- **THEN** validation fails, proving the envelope is enforced rather than merely additive

### Requirement: Error codes are bounded gateway-class codes that never leak scope, role, or existence

The system SHALL set the top-level `code` to a value matching `^GW_[A-Z0-9_]+$` derived deterministically
from the response condition (its status and error class) and identical across both runtimes for
equivalent conditions. The `code` MAY convey the error class, but SHALL NOT encode or echo a tenant id,
an authorization scope, role, or credential-scope value, a quota dimension value, a secret, or
attacker-controlled text. Only explicitly approved server-owned public classes SHALL be retained;
unknown class-shaped source values SHALL use the status-generic class.

#### Scenario: Code is bounded and deterministic

- **WHEN** any in-scope error is serialized
- **THEN** its `code` matches `^GW_[A-Z0-9_]+$`, is a stable `GW_`-prefixed class token (for example
  `GW_UNAUTHENTICATED`, `GW_FORBIDDEN`, `GW_NO_ROUTE`, `GW_CONTROL_PLANE_ERROR`), and is determined
  solely by the response condition rather than any caller-controlled input

#### Scenario: Unknown class-shaped input is not trusted

- **WHEN** a provider, datastore, or caller supplies an unapproved but syntactically class-shaped code
- **THEN** the response uses the status-generic `GW_` class and reflects none of that source token

#### Scenario: Forbidden discloses no authorization scope or role

- **WHEN** an adversarial actor from another tenant (P13) triggers a `403` on either runtime — including
  a wrong-scope denial, a cross-tenant workspace access, or an insufficient credential scope
- **THEN** the `message` is a public string and no required scope, role, credential-scope, or workspace
  binding value appears anywhere in the envelope (`code`, `message`, `detail`, or `resource`)

#### Scenario: Forbidden and not-found add no body-level foreign-existence detail

- **WHEN** P13 receives an existing authorization-selected `403` or `404`
- **THEN** normalization preserves the status semantics but adds no denial subtype, scope, role,
  credential binding, or inferred cross-tenant identifier to the body

### Requirement: Error detail is public content only and free of sensitive internals

The system SHALL build `detail` from a bounded allowlist of public keys and bounded values, SHALL drop
non-allowlisted object keys, and SHALL drop retained strings matching its bounded denylist for stack,
SQL/SQLSTATE, HTTP URLs, authentication/secret material, PostgreSQL, or MongoDB. Every `403` detail SHALL
be exactly `{ reason: 'FORBIDDEN' }`, and every `5xx` detail SHALL be `{}`. Producers SHALL NOT place
internal identifiers, headers, infrastructure names, or secrets in allowlisted public fields.

#### Scenario: Validation detail is public and structured

- **WHEN** a `400` is produced for a malformed body or query
- **THEN** `detail` contains only public content — a `reason` and/or a `violations` array of public
  strings — and no raw parser output, input echo, or exception text

#### Scenario: Denylisted sensitive content is dropped from detail

- **WHEN** a source error carries a `detail` string matching a stack, SQL/SQLSTATE, HTTP URL,
  authentication/secret, PostgreSQL, or MongoDB denylist marker
- **THEN** the serialized `detail` retains none of that matched content

#### Scenario: Server-error detail carries no diagnostic

- **WHEN** a `5xx` is serialized from a caught database or runtime exception
- **THEN** `detail` is exactly `{}` and contains no stack, exception message, SQL/SQLSTATE, URL, or secret

### Requirement: Identifiers and timestamp are validated, generated, and correlation-safe

The system SHALL always generate a `requestId` within the schema bounds, SHALL propagate an incoming
`x-correlation-id` as `correlationId` when it matches `^[A-Za-z0-9._:-]{8,128}$` and otherwise generate
a conforming `correlationId`, SHALL echo the `correlationId` in the body using the same value the
existing audit/metrics correlation uses, and SHALL emit an RFC3339 `timestamp`. It SHALL NOT echo a
missing or malformed incoming identifier as-is.

#### Scenario: Valid correlation propagates to the body and audit

- **WHEN** a request supplies a valid `x-correlation-id` and then fails
- **THEN** the same value appears as `correlationId` in the body and the existing audit/metrics
  correlation linkage is unchanged, with no duplicate normalization side effect

#### Scenario: Missing or malformed identifiers are regenerated safely

- **WHEN** the incoming request or correlation id is absent or fails the schema pattern (including
  attacker-controlled arbitrary text)
- **THEN** the server generates bounded, conforming `requestId` and `correlationId` values and never
  reflects the attacker-controlled text into the envelope

#### Scenario: Timestamp is RFC3339

- **WHEN** any in-scope error is serialized
- **THEN** `timestamp` is an RFC3339 `date-time` string that validates against the schema's
  `format: date-time`

### Requirement: Error resource is derived only from the request path the caller addressed

The system SHALL populate `resource.path` from the request pathname, exclude query and fragment data,
strip control characters, cap it at 512 characters, and collapse recognized identifier-prefix, UUID,
numeric, colon-delimited, and longer-than-64-character segments to `{id}`. Other opaque path segments
MAY remain unchanged; the public contract SHALL instruct clients never to put credentials or secrets in
path segments. The resource SHALL add no inferred identifier or existence assertion.

#### Scenario: Resource is the addressed path

- **WHEN** an in-scope error is serialized
- **THEN** `resource.path` is the bounded addressed pathname with query/fragment data and control
  characters excluded, recognized identifier forms redacted, and validates against `ErrorResource`

#### Scenario: Query strings never appear in the resource

- **WHEN** the failing request carries a query value such as an `?apikey=` SSE parameter
- **THEN** the complete query string is excluded from `resource.path` and the envelope

#### Scenario: Resource asserts no existence

- **WHEN** a `404` and a `403` are produced for the same addressed path
- **THEN** the `resource` of each is the same sanitized pathname and reveals nothing about whether the
  addressed resource exists

### Requirement: The error class and console behavior are preserved

The system SHALL keep the web console functioning across the envelope change: the top-level `GW_` `code`
SHALL convey the error class so console clients and machine clients that branch on it keep resolving it,
the status-based `describeConsoleError` copy and the `409` auth status-view funnel SHALL continue to
work, and the console SHALL render a temporarily legacy `{ code, message }` body from an older deployment
without crashing. Error-consuming console clients, including the shared reader and direct-body clients,
SHALL be updated as needed to read the canonical fields while preserving legacy-body compatibility.

#### Scenario: Error class remains resolvable

- **WHEN** the backend returns a `GW_`-prefixed class code
- **THEN** a console page or machine client that branches on the error class continues to resolve it, and
  the auth status-view funnel continues to select its status view via the preserved hint or the class
  code

#### Scenario: Console renders the canonical envelope

- **WHEN** the console receives a canonical `ErrorResponse`
- **THEN** it displays the localized status-based copy, exposes the `code`, `message`, `requestId`,
  `correlationId`, `detail`, and `resource` without crashing, and does not print raw
  implementation-leaking text

#### Scenario: Console tolerates a legacy body

- **WHEN** the console receives a legacy `{ code, message }` body from an older, not-yet-migrated
  deployment
- **THEN** the shared reader falls back gracefully (for example to `HTTP_<status>`) and the console still
  renders without error

### Requirement: Cross-runtime parity and SDK/OpenAPI template alignment

Both runtimes SHALL apply the same normalization semantics — equal status, `code` class, message
sanitization, identifier and timestamp rules, and resource derivation for equivalent conditions — and
the SDK base template
(`packages/openapi-sdk-service/src/capability-modules/base-template.openapi.json`) `ErrorResponse` (with
its `ErrorDetail`/`ErrorResource`) SHALL describe the canonical envelope and the `GW_` `code` pattern.
The change SHALL NOT loosen or edit the canonical `control-plane.openapi.json` error schema.

#### Scenario: Equivalent errors are equivalent across runtimes

- **WHEN** the control-plane and executor runtimes produce the same class of error (for example an
  unauthenticated request or an internal fault)
- **THEN** the two envelopes share the same `status`, `GW_` `code`, sanitization, identifier and
  timestamp format, and resource rules

#### Scenario: SDK template matches the canonical envelope

- **WHEN** the SDK base template is validated after the change
- **THEN** its `ErrorResponse` requires the eight envelope fields with the `GW_` `code` pattern and the
  id bounds, its `ErrorDetail`/`ErrorResource` are present, a canonical body validates against it, a
  legacy `{ code, message }` body does not, and the canonical `control-plane.openapi.json` is unchanged

### Requirement: Normalization has no new audit or metrics side effect and leaves success and out-of-scope transports unchanged

The system SHALL emit no new audit event and no new metric as a result of error normalization, SHALL
preserve the existing `recordHttp` labels and the existing enforcement-denial and mutating-action audit
writes and their correlation, SHALL normalize each response exactly once, SHALL NOT change any
successful response or success schema, and SHALL NOT rewrite streaming/SSE/JSON-RPC error frames, any
error emitted after response headers are sent, or the executor's proxy pass-through of an upstream
response.

#### Scenario: Audit and metrics continuity on failure

- **WHEN** a request fails after audit or metric instrumentation has run
- **THEN** the same events, labels, and correlation linkage are emitted exactly as before, the
  `correlationId` in the body equals the recorded value, and no duplicate normalization side effect
  occurs

#### Scenario: Successful responses are unchanged

- **WHEN** an endpoint returns a successful JSON response
- **THEN** its status, body, and success schema are unchanged by this change

#### Scenario: Read-only and adjacent personas gain nothing

- **WHEN** a scoped read-only viewer/auditor (P10) makes a permitted request that errors, or a
  privileged (P1/P4) or adjacent (P7/P9/P12) principal errors under existing authorization
- **THEN** each receives the identical envelope shape with no mutation, no new grant, and no additional
  tenant, scope, or existence information

#### Scenario: Streaming and after-header errors are not rewritten

- **WHEN** an error occurs in a streaming/SSE/JSON-RPC transport, after response headers are sent, or on
  the executor's proxy pass-through of an upstream response
- **THEN** the normalization does not rewrite that transport and does not attempt an invalid second
  response

#### Scenario: The normalizer is packaged and reachable

- **WHEN** the control-plane image is built and its error seams resolve the normalizer
- **THEN** the normalizer module is present in the image (its module is `COPY`d or rides along under an
  already-copied package) and the conformant envelope is produced without an `ERR_MODULE_NOT_FOUND`
  boot failure
