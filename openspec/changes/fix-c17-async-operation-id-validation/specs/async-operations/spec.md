# async-operations — spec delta for fix-c17-async-operation-id-validation

## ADDED Requirements

### Requirement: Operation-bearing queries require a canonical UUID

The async-operation query action SHALL require `operationId` to be a JavaScript string in
case-insensitive canonical hexadecimal `8-4-4-4-12` UUID syntax for `detail`, `logs`, and `result`
queries. It SHALL NOT require a particular UUID version or variant. It SHALL reject missing, empty,
whitespace-only, non-string, truncated, overlong, unhyphenated, braced, or otherwise non-canonical
values with action code `VALIDATION_ERROR` and status `400`. It SHALL NOT trim, stringify, or repair
invalid input. This requirement SHALL be enforced through one action-level validation chokepoint
before tenant resolution or repository access.

#### Scenario: P1 detail rejects a malformed identifier

- **WHEN** a P1 platform superadministrator submits `queryType: "detail"` with a non-UUID,
  truncated, unhyphenated, SQL-like, or overlong `operationId`
- **THEN** the action fails with `VALIDATION_ERROR` and status `400` before any repository or
  database call

#### Scenario: P3 logs rejects blank and wrong-type identifiers

- **WHEN** a P3 platform operator submits `queryType: "logs"` with an omitted, empty,
  whitespace-only, null, numeric, array, or object `operationId`
- **THEN** the action fails with `VALIDATION_ERROR` and status `400` without coercing the value

#### Scenario: P10 result uses the same validation boundary

- **WHEN** a P10 constrained/read-only caller who has existing operation-read permission submits
  `queryType: "result"` with any non-canonical identifier class
- **THEN** the same `VALIDATION_ERROR`/`400` outcome applies and the change grants no additional
  permission or mutation capability

#### Scenario: Canonical UUID syntax is version-neutral

- **WHEN** an authenticated caller supplies an upper- or lower-case canonical `8-4-4-4-12`
  hexadecimal UUID, including a nil or future-version value
- **THEN** format validation succeeds and the request proceeds to the existing scoped domain lookup

### Requirement: Validation failures stop before persistence and success telemetry

A rejected operation identifier SHALL NOT invoke `getOperationById`, `getOperationLogs`,
`getOperationResult`, or issue any database query. It SHALL NOT perform a write or publish the
successful `console.async-operation.accessed` access event, structured
`async_operation_query_completed` log, or its success metric annotations. The HTTP listener MAY
record its ordinary bounded request/status metrics. At the HTTP boundary, the action
`VALIDATION_ERROR` SHALL be serialized using the existing C-02 canonical `ErrorResponse` with status
`400` and public code `GW_VALIDATION_ERROR`.

#### Scenario: Invalid detail stops before every backing layer

- **WHEN** an authenticated P1 or P3 caller submits an invalid ID for `detail`
- **THEN** no repository method, PostgreSQL query, write, access-audit publication, completion log,
  or success metric annotation occurs

#### Scenario: Invalid logs and result share the same no-side-effect outcome

- **WHEN** an authenticated caller submits an invalid ID for `logs` or `result`
- **THEN** each request stops at the same action chokepoint with zero backing-layer or successful
  access-telemetry side effects

#### Scenario: HTTP response is canonical and provider-safe

- **WHEN** the real control-plane HTTP boundary handles the action's `VALIDATION_ERROR`
- **THEN** it returns a schema-valid C-02 `ErrorResponse` with status `400`, stable public code
  `GW_VALIDATION_ERROR`, request/correlation/resource context, and no SQLSTATE `22P02`, SQL text,
  bound value, provider name, connection data, or stack trace

### Requirement: Authentication and tenant isolation remain unchanged

Trusted caller-context validation SHALL remain before operation-ID format validation. Missing or
untrusted identity SHALL retain the existing unauthenticated response and SHALL NOT query
persistence. For canonical IDs, tenant resolution and repository predicates SHALL remain unchanged.
A non-superadmin's explicit canonical cross-tenant filter SHALL retain its existing
`TENANT_ISOLATION_VIOLATION`/`403` outcome. A canonical operation ID belonging to another tenant,
when requested without an explicit conflicting filter, SHALL be evaluated under the caller's
verified tenant predicate and SHALL be indistinguishable from a canonical absent ID through
`NOT_FOUND`/`404` without foreign metadata.

#### Scenario: Authentication retains precedence over malformed input

- **WHEN** a request has missing or untrusted identity and also carries a malformed `operationId`
- **THEN** it retains the existing `401` outcome, performs no database/access-audit work, and
  reveals no resource or provider detail

#### Scenario: Valid explicit cross-tenant filter retains 403

- **WHEN** a non-superadmin P10 or P13 caller supplies a canonical operation ID and a tenant filter
  that conflicts with trusted caller context
- **THEN** the action returns the existing `TENANT_ISOLATION_VIOLATION`/`403` before lookup

#### Scenario: P13 valid foreign identifier is non-leaking

- **WHEN** a P13 caller presents a canonical UUID for an operation owned by another tenant without
  an explicit conflicting tenant filter
- **THEN** the verified tenant predicate returns the same `NOT_FOUND`/`404` outcome as a canonical
  absent UUID and exposes no foreign data, scope, count, or existence signal

#### Scenario: Combined malformed and scope errors are not redesigned

- **WHEN** an authenticated request contains both a malformed operation ID and a conflicting tenant
  filter
- **THEN** the current action ordering is retained and this change introduces no new authorization
  or existence semantics beyond rejecting the malformed ID before persistence

### Requirement: Canonical existing and unknown IDs preserve domain behavior

An accessible existing canonical ID SHALL keep the current `detail`, `logs`, or `result` success
projection, status `200`, operation-derived correlation header, one
`console.async-operation.accessed` publication, one `async_operation_query_completed` structured
log with the existing metric annotations, and read-only state. A canonical ID absent from the
caller's authorized scope SHALL continue to invoke the scoped lookup and fail as
`NOT_FOUND`/`404`, not `400` or `500`, without publishing a successful access event.

#### Scenario: P1 and P3 existing reads remain compatible

- **WHEN** an authorized P1 or P3 caller requests `detail`, `logs`, or `result` for an existing
  canonical in-scope operation ID
- **THEN** the current response projection, status `200`, correlation header, single successful
  audit/log/metric behavior, and unchanged persisted state are preserved

#### Scenario: Canonical unknown identifier remains 404

- **WHEN** an authorized caller requests any operation-bearing query type with a canonical UUID
  that is absent from the caller's scope
- **THEN** the scoped lookup occurs and the action returns `NOT_FOUND`/`404` without a provider error

### Requirement: List query behavior remains compatible

The `list` query type SHALL remain exempt from the `operationId` requirement. Its filters, tenant
resolution, authorization, status-array semantics, ordering, pagination, response projection,
correlation, successful access-audit/log/metric behavior, and read-only state SHALL remain
unchanged. An irrelevant `operationId` field on a `list` request SHALL NOT change list behavior.

#### Scenario: P3 list without operation identifier is unchanged

- **WHEN** an authenticated P3 caller submits `queryType: "list"` with existing filters and
  pagination and no `operationId`
- **THEN** the action follows the existing list path and returns the existing scoped response

#### Scenario: Irrelevant list identifier does not create a new contract

- **WHEN** an authenticated caller includes an irrelevant malformed or canonical `operationId` on a
  `list` request
- **THEN** list selection and side effects remain unchanged and the field does not become a list
  validation requirement
