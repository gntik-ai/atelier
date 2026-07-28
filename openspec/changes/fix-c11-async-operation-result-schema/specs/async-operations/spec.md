# async-operations — spec delta for fix-c11-async-operation-result-schema

## ADDED Requirements

### Requirement: The canonical migration chain provides async-operation result columns

The system SHALL provide `packages/provisioning-orchestrator/src/migrations/079-async-operation-results.sql` as an idempotent additive migration that adds nullable `result JSONB` and `completed_at TIMESTAMPTZ` columns to `async_operations`. The migration SHALL NOT define a default, backfill existing rows, create an index, add a constraint or trigger, or change operation statuses. Every canonical schema application list SHALL register migration 079 immediately after migration 078 and, wherever migration 080 is present, before migration 080.

#### Scenario: Existing schema is upgraded

- **WHEN** migrations 073, 074, 075, 076, and 078 have already been applied and migration 079 is
  applied
- **THEN** PostgreSQL exposes nullable `result` as `jsonb` and nullable `completed_at` as
  `timestamp with time zone`, both without defaults, and every existing row retains its prior data
  with null values for the new columns

#### Scenario: Fresh schema follows canonical order

- **WHEN** the control-plane schema bootstrap or local PostgreSQL bootstrap applies the canonical
  migration sequence
- **THEN** migration 079 runs after 078, before 080, and before the result repository is considered
  ready to serve queries

#### Scenario: Migration application is repeated

- **WHEN** the actual migration chain including 079 is applied a second time to the same PostgreSQL
  schema
- **THEN** the second application succeeds without duplicate columns, data loss, default changes,
  backfill, or index creation

### Requirement: Async-operation lifecycle owns result and terminal timestamps

The system SHALL keep `result` and `completed_at` null when an operation is created and while it is nonterminal. When an operation enters `completed`, the repository lifecycle SHALL persist an optional safe/sanitized result and SHALL set `completed_at` to the terminal transition instant. When an operation enters `failed`, `timed_out`, or `cancelled`, the repository lifecycle SHALL persist a null result and SHALL set `completed_at` to the terminal transition instant. A terminal transition SHALL use the same instant for `updated_at` and `completed_at`.

#### Scenario: Pending operation is created

- **WHEN** a caller creates an async operation through the real creation model and repository
- **THEN** the stored operation is `pending` with null `result` and null `completed_at`

#### Scenario: Operation remains nonterminal

- **WHEN** an operation is `pending`, `running`, or `cancelling`
- **THEN** its lifecycle state carries no result and no completion timestamp

#### Scenario: Operation completes with a safe result

- **WHEN** a running operation transitions to `completed` with an optional safe result projection
- **THEN** the repository stores that sanitized JSONB value, sets `completed_at` to the terminal
  transition instant, and records the existing transition history atomically

#### Scenario: Operation completes without a result

- **WHEN** a running operation transitions to `completed` without a result projection
- **THEN** the repository stores a null result and a non-null terminal `completed_at`

#### Scenario: Operation fails or reaches another terminal outcome

- **WHEN** an operation transitions to `failed`, `timed_out`, or `cancelled`
- **THEN** the repository stores a null result, sets a non-null terminal `completed_at`, and
  preserves the existing error or cancellation fields for that outcome

### Requirement: Persisted operation results are safe and bounded

The system SHALL persist only JSON-compatible operation-history output that has been sanitized before or at the repository lifecycle boundary. Normalization SHALL build a detached canonical value from enumerable data properties in one pass and SHALL reject accessors, Proxy objects, and prototype-affecting keys so validation and serialization cannot observe different values, execute traps, or mutate the detached value's prototype. Canonical serialization SHALL ignore inherited `toJSON` hooks and preserve the existing ordinary Object/Array result contract. It SHALL reject NUL and unpaired UTF-16 surrogates in object field names or string values that PostgreSQL JSONB cannot represent. Every non-null normalized object, array, string, number, or boolean SHALL be serialized explicitly and bound as JSONB. A persisted result SHALL NOT contain credentials, passwords, provider tokens, access-key identifiers, secret-key aliases, private keys, connection strings, HTTPS userinfo, raw stack traces, internal filesystem paths, or equivalent sensitive/internal material. A persisted object's `summary` and `message` fields, when present, SHALL be strings or null. The result query, access audit, structured logs, and metrics SHALL NOT expose the stored raw JSONB result.

#### Scenario: Safe summary is completed

- **WHEN** a terminal writer supplies a safe result containing a consumer-facing `summary` or
  `message`
- **THEN** the sanitized value may be persisted and the existing result projection may use that
  text as its summary

#### Scenario: Safe scalar or container result is completed

- **WHEN** a terminal writer supplies a safe object, array, string, finite number, or boolean
- **THEN** the repository serializes the value explicitly and PostgreSQL returns the same JSONB
  value without leaving the operation nonterminal

#### Scenario: Completion result contains sensitive material

- **WHEN** a terminal writer supplies a result containing a secret-like key, credential,
  provider token, HTTPS userinfo, connection string, stack trace, internal path, or equivalent
  adversarial content
- **THEN** the lifecycle boundary rejects, removes, or redacts that material before persistence,
  and neither storage nor any result-read side effect exposes it

#### Scenario: Completion result uses an accessor-backed value

- **WHEN** an internal terminal writer supplies an object whose accessor could return different
  values during validation and serialization
- **THEN** the lifecycle boundary rejects the result before invoking the accessor and no value
  from that object reaches durable operation or saga storage

#### Scenario: Completion result is not safe for canonical JSONB persistence

- **WHEN** a terminal writer supplies a prototype-affecting key, or NUL or an unpaired UTF-16
  surrogate in a field name or string value
- **THEN** the lifecycle boundary rejects the result before any operation or saga result write

#### Scenario: Completion summary has an incompatible type

- **WHEN** a terminal writer supplies an object whose `summary` or `message` is neither a string
  nor null
- **THEN** the lifecycle boundary rejects the result and leaves the nonterminal operation
  unchanged

#### Scenario: Failure carries partial output

- **WHEN** an operation fails after producing partial output
- **THEN** the terminal lifecycle stores null in `result` and uses the existing safe error fields
  rather than treating partial output as a successful result

### Requirement: Retry clears terminal result state

The system SHALL clear both `result` and `completed_at` whenever a retry returns a terminal operation to `pending`. This invariant SHALL apply to ordinary retry and supervised retry override under their existing authorization, tenant, attempt-count, correlation, transition, and event rules.

#### Scenario: Failed operation is retried normally

- **WHEN** an eligible failed operation with a terminal timestamp is reset through the ordinary
  retry action
- **THEN** the operation becomes `pending`, its attempt and correlation data follow the existing
  retry rules, and both `result` and `completed_at` are null

#### Scenario: Superadmin authorizes a retry override

- **WHEN** an eligible intervention-required operation is returned to `pending` through the
  supervised retry-override action
- **THEN** the existing override and flag workflow is preserved and both `result` and
  `completed_at` are null

#### Scenario: Retry transaction fails

- **WHEN** any write in an existing retry transaction fails
- **THEN** status, result, completion time, attempt data, and related retry records retain the
  existing atomic rollback behavior

### Requirement: Later classification preserves terminal values

Failure classification and manual-intervention updates SHALL preserve an operation's existing `result` and `completed_at`. Updating classification fields or `updated_at` SHALL NOT clear, replace, or recompute the terminal result or terminal instant.

#### Scenario: Failed operation is classified after termination

- **WHEN** failure category, error code, description, suggested actions, or intervention state is
  updated for a failed operation
- **THEN** the operation retains the same result value and `completed_at` that it had before
  classification

#### Scenario: Completed operation is read after unrelated metadata work

- **WHEN** a completed operation has later non-lifecycle metadata activity
- **THEN** its stored result and terminal completion instant remain stable

### Requirement: Durable saga terminal writes use the repository lifecycle

Durable saga completion and failure SHALL use the canonical async-operation repository lifecycle instead of a separate direct async-operation status update. The repository SHALL write terminal status, result, completion time, and transition history once, while the saga SHALL preserve its current saga-run persistence, compensation behavior, best-effort operation mirror, and operation logging.

#### Scenario: Attached saga completes

- **WHEN** a durable saga attached to an async operation completes with an optional safe result
- **THEN** the saga-run record completes and the repository transitions the async operation once
  to `completed` with the sanitized result and terminal timestamp

#### Scenario: Attached saga receives an unsafe optional completion result

- **WHEN** a durable saga completion result fails the safe-result boundary
- **THEN** the saga omits the result from both durable stores, emits one bounded warning without
  the unsafe content, and transitions the async-operation mirror once to `completed`

#### Scenario: Attached saga fails

- **WHEN** a durable saga attached to an async operation fails
- **THEN** the saga-run stores only a trimmed safe failure message of at most 4096 UTF-8 bytes,
  every persisted error-summary field is bounded, free of credential material, and detached from
  enumerable data properties without invoking accessors, Proxy traps, or inherited serialization
  hooks, compensation behavior remains unchanged, and the repository transitions the async
  operation once to `failed` with the same safe error summary, null result, and terminal timestamp

#### Scenario: Best-effort operation mirror is unavailable

- **WHEN** the existing best-effort async-operation mirror cannot be attached or updated
- **THEN** the saga retains its current failure-containment behavior and does not broaden this
  change into a saga availability redesign

### Requirement: Operation result reads preserve the current response contract

The result query SHALL return the existing fields `queryType`, `operationId`, `status`, `resultType`, `summary`, `failureReason`, `retryable`, and `completedAt` and SHALL NOT return the stored raw result. It SHALL preserve the current mapping of `completed` to `success`, `failed` to `failure`, and other current states to `pending`. For every domain-terminal status (`completed`, `failed`, `timed_out`, or `cancelled`), it SHALL prefer stored `completed_at` and SHALL use `updated_at` when the stored value is null. For every nonterminal status (`pending`, `running`, or `cancelling`), it SHALL return no completion time even if stale storage contains one. Summary and failure-reason projection SHALL defensively return null for non-string legacy values. `failureReason` and `retryable` SHALL be projected only for the `failure` result type, even when a legacy non-failed row retains stale `error_summary` data.

#### Scenario: Completed result is queried

- **WHEN** an authorized caller queries the result of a completed operation with a stored safe
  summary
- **THEN** the action returns `200` with `queryType: "result"`, the existing success projection,
  that summary, null failure fields, and the stored completion time, without a raw result field

#### Scenario: Failed result is queried

- **WHEN** an authorized caller queries the result of a failed operation
- **THEN** the action returns `200` with the existing failure projection, null success summary,
  the existing failure reason/retryability projection, and the terminal completion time

#### Scenario: Pending result is queried

- **WHEN** an authorized caller queries the result of a pending or otherwise nonterminal operation
- **THEN** the action returns `200` with the existing pending projection and null summary,
  failure, retryability, and completion-time values

#### Scenario: Legacy domain-terminal row has no completion timestamp

- **WHEN** an authorized caller queries a `completed`, `failed`, `timed_out`, or `cancelled` row
  whose `completed_at` remains null
- **THEN** `completedAt` uses that row's current `updated_at` value without a migration backfill

#### Scenario: Nonterminal row contains a stale completion timestamp

- **WHEN** an authorized caller queries a `pending`, `running`, or `cancelling` row whose storage
  contains a stale `completed_at`
- **THEN** `completedAt` is null and the existing C-12 result-type mapping remains unchanged

#### Scenario: Non-failed row contains stale failure metadata

- **WHEN** a completed or nonterminal legacy row retains an `error_summary`
- **THEN** its result response returns null `failureReason` and `retryable` fields

#### Scenario: Legacy summary has an incompatible type

- **WHEN** a completed legacy row contains a `summary` or `message` value that is neither a string
  nor null
- **THEN** the result response projects `summary: null` and remains compatible with the internal
  response schema

#### Scenario: Adjacent query controls are used

- **WHEN** an authorized caller queries detail or logs for the same operation
- **THEN** those existing branches continue to return `200` under their current response contracts

### Requirement: Result reads preserve authentication and tenant isolation

The result action SHALL preserve current caller-context validation, tenant resolution, superadmin behavior, and operation lookup by verified tenant. Server-owned identity and transport parameters SHALL be assigned after request-derived flattened values so body, query, defaults, or path parameters cannot replace trusted `__ow_headers`, method, or path context. A tenant caller SHALL NOT learn whether an operation exists in another tenant. A wrong-tenant operation identifier and an unknown operation identifier SHALL retain indistinguishable `404` behavior.

#### Scenario: Tenant caller queries its own operation

- **WHEN** an authenticated tenant-scoped P1, P7, or P9 caller queries an operation owned by its
  verified tenant
- **THEN** the action evaluates and returns the result under the existing tenant predicate

#### Scenario: Tenant caller queries another tenant's operation

- **WHEN** a tenant-scoped caller, including the P10 isolation/access persona, submits an operation
  identifier owned by another tenant
- **THEN** the action returns the same `404` resource behavior as an unknown identifier and
  discloses no owner, status, result, timestamp, error, or existence detail

#### Scenario: Caller queries an unknown operation

- **WHEN** an authenticated caller submits an operation identifier that has no matching visible
  row
- **THEN** the action returns the existing `404` response and does not turn the absence into a
  schema error

#### Scenario: Identity is missing or untrusted

- **WHEN** a request lacks the trusted caller identity required by the action
- **THEN** the action retains its current unauthorized behavior without querying or disclosing an
  operation result

#### Scenario: Request body attempts to replace trusted identity

- **WHEN** a tenant-scoped caller includes forged `__ow_headers` or transport fields in the body,
  query, defaults, or matched path parameters
- **THEN** dispatch retains the server-verified identity, method, and path while ordinary action
  fields retain their existing merge behavior

#### Scenario: Superadmin queries under current scope rules

- **WHEN** a superadmin queries an operation result with the tenant resolution allowed by the
  current action
- **THEN** the action retains the current superadmin access behavior and does not add a new bypass
  or restriction

### Requirement: Successful result access preserves audit and console observability

A successful result query SHALL retain the current correlation response header when available, `console.async-operation.accessed` access-audit publication, `async_operation_query_completed` structured log, and async-operation query metrics. These side effects SHALL retain their current fields and SHALL NOT include the stored raw result. The Operations console result hook SHALL receive the repaired backend response without requiring a production route, component, polling, interaction, copy, or visual redesign.

#### Scenario: Successful result query is observed

- **WHEN** an authorized P1, P3, P7, or P9 caller receives a successful operation result
- **THEN** the action returns the current correlation header when available, publishes the current
  access-audit payload, and emits the current completion log and query metrics without raw result
  content

#### Scenario: Operations console consumes the repaired action

- **WHEN** the adjacent P4 Operations console or its result hook requests a visible operation
  result
- **THEN** it receives the existing `200` response shape instead of the C-11 schema-originated
  `500`, with no production UI redesign required

#### Scenario: Adversarial caller probes result data

- **WHEN** a P13 caller queries a result they are authorized to see or probes an operation outside
  their tenant
- **THEN** the response contains only the existing safe projection for visible data or the existing
  non-disclosing `404` for invisible data, and never exposes raw persisted result content

### Requirement: Schema readiness gates route serving

The control plane SHALL distinguish database liveness from schema readiness. `/healthz` SHALL
continue to execute the database liveness check independently. `/readyz` and every mapped product
route SHALL return `503` until schema application and saga recovery succeed. Exhausting migration
retries SHALL retain the existing non-zero process exit behavior.

#### Scenario: Database is live while schema bootstrap is pending

- **WHEN** `SELECT 1` succeeds but schema application or saga recovery has not completed
- **THEN** `/healthz` may return `200`, while `/readyz` and a mapped product route return `503`

#### Scenario: Schema and recovery succeed

- **WHEN** all boot migrations and saga recovery complete successfully
- **THEN** the readiness gate opens and `/readyz` performs its database liveness check before
  returning success

#### Scenario: Migration retries are exhausted

- **WHEN** schema application or recovery keeps failing through the configured retry budget
- **THEN** readiness remains closed and the control-plane process exits non-zero for restart

### Requirement: Regression proof uses the real schema, repository, and action

The automated C-11 acceptance proof SHALL run against actual PostgreSQL, apply the real migration chain, and exercise the real async-operation repository and query action. It SHALL NOT define a handcrafted `async_operations` table that pre-adds `result` or `completed_at`, and mock-only tests SHALL NOT be accepted as schema compatibility proof. The dedicated package command SHALL fail rather than skip when neither `TEST_DATABASE_URL` nor `DATABASE_URL` is configured, and CI SHALL run it against a PostgreSQL 16 service.

#### Scenario: Real migration chain is tested twice

- **WHEN** the focused PostgreSQL regression suite prepares its isolated schema
- **THEN** it applies actual migrations 073, 074, 075, 076, 078, and 079 in order twice and verifies
  migration order, idempotency, exact column properties, and absence of a result-specific index

#### Scenario: Real repository and action cover lifecycle projections

- **WHEN** the suite creates and transitions operations through real repository writers and
  queries them through the real action
- **THEN** it covers completed, failed, pending, legacy-null, retry-clearing, classification,
  timeout/cancellation, and saga-writer behavior against actual persisted rows

#### Scenario: Isolation and adjacent controls run on the same schema

- **WHEN** the suite executes result, detail, logs, wrong-tenant, and unknown-operation controls
  against the migrated PostgreSQL schema
- **THEN** result/detail/log success paths avoid SQLSTATE `42703`, detail and logs return `200`, and
  both invisible result controls retain `404`

#### Scenario: CI lacks a database URL

- **WHEN** the dedicated C-11 PostgreSQL command runs without `TEST_DATABASE_URL` or `DATABASE_URL`
- **THEN** it exits non-zero with a clear configuration error instead of reporting skipped tests

### Requirement: Normal rollback retains the additive columns

Normal application rollback SHALL leave `async_operations.result` and `async_operations.completed_at` in place. Retaining the columns SHALL be treated as schema-safe but SHALL NOT imply that code which retries terminal rows without clearing both fields is mixed-version lifecycle-safe. Dropping either column SHALL be treated as a separate destructive migration because it discards stored lifecycle data and reintroduces C-11 while the current result repository selects those columns.

#### Scenario: Application revision is rolled back

- **WHEN** the C-11 application changes are reverted to an older compatible revision
- **THEN** both nullable columns and their stored data remain in PostgreSQL and the compatible code
  may ignore them at the schema level

#### Scenario: Rolled-back code does not clear terminal fields on retry

- **WHEN** an older revision can return a terminal operation to `pending` without clearing
  `result` and `completed_at`
- **THEN** that retry path is disabled during rollback or the rollback is rejected as
  mixed-version lifecycle-unsafe

#### Scenario: Column removal is proposed

- **WHEN** an operator considers dropping `result` or `completed_at`
- **THEN** the removal is rejected as a normal rollback and requires a separately approved
  destructive migration after every referencing reader and writer has been removed and stored data
  has been protected or explicitly abandoned

#### Scenario: Current result reader remains reachable

- **WHEN** `getOperationResult` still selects `result` and `completed_at`
- **THEN** neither column may be dropped because doing so would restore the HTTP
  `500`/SQLSTATE `42703` failure
