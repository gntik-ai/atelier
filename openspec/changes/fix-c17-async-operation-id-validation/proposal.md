# Change: Validate async-operation identifiers before persistence

## Why

C-17 / JT-OO-03 is an independently confirmed operations defect. In the historical E6 audit,
`POST /v1/async-operation-query` with `queryType: "detail"` and
`operationId: "not-a-uuid"` returned `500 CONTROL_PLANE_ERROR`, while the positive control with a
canonical but unknown UUID returned `404 NOT_FOUND`. The finding was reproduced again without a
cluster on `codex-integration` commit `56566a7c`: the malformed value was bound to
`async_operations.operation_id`, PostgreSQL-compatible SQLSTATE `22P02` propagated through the
action, and the action assigned status `500`.

The root cause is in
`packages/provisioning-orchestrator/src/actions/async-operation-query.mjs`.
`requireOperationId` verifies only that an identifier is present. It does not verify that the value
is a string in canonical UUID syntax before `getOperationById` passes it to
`packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs`. Because the
database column is `UUID`, a client validation failure is misclassified as an internal service
failure.

P1 platform superadministrators and P3 platform operators/SREs use operation detail, logs, and
results to investigate failed provisioning. A malformed or stale URL must produce deterministic,
bounded feedback rather than look like a control-plane incident. P10 constrained/read-only users
must receive the same input semantics without broader access. P13 actors from another tenant must
not be able to use a malformed or copied operation identifier to reveal storage details or foreign
operation existence.

## What Changes

- Add one canonical, case-insensitive `8-4-4-4-12` hexadecimal UUID predicate at the
  async-operation query action boundary. The predicate does not require a particular UUID version.
- Apply the predicate uniformly to `detail`, `logs`, and `result` requests. Missing, blank,
  whitespace-only, non-string, truncated, overlong, unhyphenated, or otherwise non-canonical
  identifiers fail as action `VALIDATION_ERROR` with status `400`.
- Reject invalid identifiers before any async-operation repository method or database query, successful
  `console.async-operation.accessed` audit publication, structured completion log, or success
  metric annotation.
- Preserve the HTTP boundary established by C-02: the action's `VALIDATION_ERROR` is serialized as
  the canonical HTTP `ErrorResponse` with stable public code `GW_VALIDATION_ERROR`. PostgreSQL
  `22P02`, SQL text, bound values, stack traces, and provider names never reach the response.
- Preserve existing authentication order. Missing or untrusted identity still produces `401`
  before operation-ID validation. This change does not reorder simultaneous validation and
  tenant-filter errors.
- Preserve tenant isolation for valid identifiers. An explicit valid cross-tenant filter retains
  its existing `403 TENANT_ISOLATION_VIOLATION`; a canonical UUID for a foreign or absent operation
  is looked up under the caller's verified tenant and remains a non-leaking `404 NOT_FOUND`.
- Preserve authorized `200` behavior for existing canonical IDs, including the response
  projections, correlation header, one access-audit publication, one structured completion log,
  and the existing query metric annotations.
- Leave `list` filtering, pagination, ordering, authorization, response shape, and side effects
  unchanged. A list query does not acquire an `operationId` requirement.
- Update the focused console-operations architecture reference and add black-box, action, HTTP
  contract, repository-adjacent, and local real-PostgreSQL regressions.

## Capability Chain

The affected chain is:

`operations route/client -> POST /v1/async-operation-query -> authenticated control-plane dispatch
-> trusted caller context -> async-operation query action -> scoped repository -> PostgreSQL UUID
column -> access audit / structured log / metric annotations -> operations documentation`

No visible UI control changes. A malformed operation route may continue to use the existing console
error/retry presentation, but the backend response feeding it changes from an internal `500` to a
bounded validation `400`. The client request shape and successful response contracts do not change.

## Personas and Observable Outcomes

- **P1 — Platform superadministrator (primary):** a malformed operation link produces a stable
  validation error; canonical in-scope reads continue to return the existing detail/log/result
  data and correlation evidence.
- **P3 — Platform operator/SRE (primary):** invalid input is distinguishable from an infrastructure
  outage, reducing false incident diagnosis. Valid unknown IDs remain a domain `404`.
- **P10 — Organization/workspace viewer or auditor (constrained/read-only):** validation remains
  read-only, adds no permission, performs no database lookup for malformed IDs, and preserves the
  caller's current tenant-scoped read behavior for valid IDs.
- **P13 — Actor from another tenant (adjacent/adversarial):** malformed input cannot trigger a
  provider diagnostic, a valid foreign ID is indistinguishable from a valid absent ID, and an
  explicit cross-tenant filter retains the existing isolation denial.

## Non-Goals

- No remediation of C-02, C-03, C-08, C-11, C-12, C-13, C-14, or any other audit finding.
- No new public route, query type, filter, pagination model, status value, retry/cancel operation,
  or operation mutation.
- No public OpenAPI, generated SDK, route-catalog, gateway-policy, or frontend request-type change.
  The route remains the existing authenticated internal console query surface.
- No database migration, column, index, constraint, trigger, backfill, repository query rewrite,
  or result/status vocabulary change.
- No authentication, role, permission, tenant-scope, quota, audit, logging, metrics, or correlation
  redesign.
- No console page, component, interaction, copy, accessibility, polling cadence, or visual change.
- No Helm/chart/deployment change, cluster access, rollout, live verification, loop-state update,
  evidence artifact, credential, kubeconfig, Playwright result, or agent/runtime file change.
- No new combined-error precedence contract for a request that contains both a malformed identifier
  and a conflicting tenant filter. The current action order remains bounded to this fix.

## Exit Criteria

- `detail`, `logs`, and `result` reject every specified invalid identifier class as action
  `VALIDATION_ERROR`/`400` before persistence and successful access telemetry.
- The real control-plane HTTP boundary returns a schema-valid C-02 error envelope with public code
  `GW_VALIDATION_ERROR` and no provider detail.
- Canonical unknown and foreign operation IDs remain non-leaking `404 NOT_FOUND`; an explicit valid
  cross-tenant filter remains `403`; an existing in-scope ID retains its current `200` projection
  and correlation/audit/log/metric behavior.
- Missing or untrusted identity retains `401`, and `list` behavior remains unchanged.
- Black-box TDD, focused unit/contract tests, and the isolated local PostgreSQL integration pass.
- The focused documentation describes accepted identifier syntax, 400/404 behavior, scope safety,
  and verification commands.
- `openspec validate fix-c17-async-operation-id-validation --strict`, relevant repository
  validators, Markdown lint, and `git diff --check` pass.
- Independent journey, contract, authorization, original-finding verifier, documentation, and final
  reviewer gates pass without deploying or contacting a cluster.

## Risks and Rollback

The primary compatibility risk is rejecting a UUID spelling that PostgreSQL accepts but the
existing JSON Schema `format: uuid` and Falcone response contracts do not treat as canonical. The
predicate therefore accepts upper- or lower-case hexadecimal canonical `8-4-4-4-12` strings without
requiring a version or variant, while deliberately rejecting whitespace, missing hyphens, braces,
and non-string coercions. Tests cover canonical upper/lower-case controls and malformed classes.

The second risk is changing authentication or isolation precedence. Validation remains after trusted
caller-context checks, exactly where the existing presence check runs. Valid cross-tenant and
foreign-ID controls prove that the tenant predicate and denial behavior are unchanged.

The third risk is accidentally emitting success-oriented audit/log/metric side effects for a
rejected request. Black-box spies and local integration assertions require zero successful
operation-access publication and zero completion log/metric annotation for validation failures;
normal request-level HTTP metrics may continue to record the bounded 400 response.

Rollback is a revert of the action predicate, focused tests, documentation, and this OpenSpec
package. There is no schema, data, deployment, or generated-client migration to reverse. Reverting
reintroduces C-17 but does not require data repair.
