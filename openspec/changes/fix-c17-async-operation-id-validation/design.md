# Design: Async-operation identifier validation boundary

## Context

`POST /v1/async-operation-query` multiplexes `list`, `detail`, `logs`, and `result` reads through
`packages/provisioning-orchestrator/src/actions/async-operation-query.mjs`. The action constructs
trusted caller context, validates caller identity and query type, performs only a presence check for
operation-bearing queries, resolves tenant scope, and invokes the scoped repository.

`getOperationById` binds the raw input as `operation_id = $1`. Migration
`073-async-operation-tables.sql` defines the column as PostgreSQL `UUID`. Malformed text therefore
raises `22P02` before the scoped query can return a domain result. The action catch assigns an
unmapped exception status `500`; the control-plane HTTP boundary correctly masks the provider
error, but the client still receives the wrong error class.

## Goals

- Classify malformed operation IDs as client validation errors at the action boundary.
- Cover every operation-bearing query type through one validation chokepoint.
- Keep malformed input out of the datastore and successful operation-access telemetry.
- Preserve trusted identity, tenant isolation, domain-not-found, success, and list behavior.
- Preserve the canonical C-02 HTTP error envelope without expanding this change into error-envelope
  redesign.

## Non-Goals

- Defining a new request schema or public API surface.
- Changing repository SQL, database schema, operation status/result contracts, authorization,
  frontend routing, or observability design.
- Normalizing/coercing client input by trimming, stringifying, removing braces, or inserting
  hyphens.

## Decision

Define a local, case-insensitive canonical UUID predicate in the async-operation query action. A
valid value is a JavaScript string matching five hexadecimal groups of lengths `8-4-4-4-12`.
Falcone does not require a particular version nibble or RFC variant for this existing database ID,
so canonical nil, future-version, upper-case, and lower-case UUIDs pass format validation.

Extend the existing `requireOperationId(queryType, operationId)` chokepoint. For `detail`, `logs`,
and `result`, it rejects a missing or non-matching value with an error carrying
`code: "VALIDATION_ERROR"` and `statusCode: 400`. For `list`, it returns without inspecting an
irrelevant `operationId`, preserving current compatibility.

Validation remains after trusted caller-context/identity and query-type checks and before
`resolveTenantScope` and repository invocation. This preserves the current 401-first behavior and
does not introduce an unrelated reordering of simultaneous malformed-ID and tenant-filter errors.

## Request Sequence

```text
HTTP authentication and trusted headers
  -> build caller context
  -> require trusted caller identity (401/validation as today)
  -> require supported queryType
  -> require canonical operationId for detail/logs/result (400)
  -> resolve tenant scope (including existing valid cross-tenant 403)
  -> scoped getOperationById
  -> 404 for canonical absent/foreign ID, or detail/log/result projection
  -> one successful access audit + completion log/metric annotations + correlation response
```

The malformed-ID branch ends before tenant lookup, any database query, action-level access audit,
structured success log, and success metric annotations. The server may still emit ordinary bounded
HTTP request telemetry for the 400 response.

## Error Semantics

At the action boundary, callers and focused tests observe an exception with
`code: "VALIDATION_ERROR"` and `statusCode: 400`. At the real control-plane HTTP boundary,
`normalizeErrorResponse` serializes that stable application error using the existing C-02
`ErrorResponse` contract and public code `GW_VALIDATION_ERROR`.

The public response must not include SQLSTATE `22P02`, the exception message, query text, bound
values, PostgreSQL/provider naming, connection data, or stack traces. This design relies on early
validation for classification and the existing HTTP normalizer for representation; it does not
change the normalizer.

## Security and Tenant Isolation

- Missing/untrusted identity is evaluated before identifier format and remains 401 without a
  database query.
- For a valid ID, a non-superadmin's explicit filter targeting a different tenant remains 403 before
  lookup.
- Without an explicit conflicting filter, a canonical foreign operation ID is queried with the
  caller's verified tenant predicate and returns the same 404 as a canonical absent ID.
- Invalid inputs never reach a database cast, so they cannot serve as a provider-error oracle.
- The change adds no role, permission, cross-tenant scope, write path, or new existence signal.

## Success and Side-Effect Compatibility

Existing canonical in-scope IDs continue through the same repository functions and formatters. A
successful `detail`, `logs`, or `result` request keeps its body projection, operation-derived
correlation header, one `console.async-operation.accessed` publication, one
`async_operation_query_completed` structured log containing the existing metric annotations, and
read-only behavior. `list` keeps its current filters, ordering, pagination, isolation, and per-request
side effects.

## Test Strategy

- A dedicated black-box suite drives the action's public `main` entrypoint with trusted headers and
  a PostgreSQL-faithful adapter that throws `22P02` if malformed input reaches a UUID predicate. It
  covers every invalid class across all three query types and spies on database, publication, log,
  metrics, and writes.
- Black-box controls cover canonical unknown, canonical foreign, canonical existing, unauthenticated,
  explicit cross-tenant, and list requests.
- The focused real-PostgreSQL suite applies the async-operation migration chain in an isolated local
  schema and proves invalid/unknown/existing behavior without a Kubernetes deployment.
- A hermetic HTTP contract test uses the real control-plane listener seam to prove status 400,
  schema-valid C-02 envelope/public code, correlation, resource path, and provider-detail masking.
- Existing trusted-context, repository, response-contract, C-11 result, C-13 status-array, and console
  polling tests guard adjacent compatibility.

## Rollback

Revert the local predicate, focused regressions, documentation paragraph, and OpenSpec change. No
database or deployment rollback is necessary because the implementation does not mutate state or
change persisted representation.
