# Tasks: Validate async-operation identifiers before persistence

## 1. Keep the change bounded to C-17

- [x] T01.1 Keep the proposal, design, and `async-operations` delta aligned only with C-17 /
  JT-OO-03: malformed `operationId` values reaching PostgreSQL and becoming 500 responses.
  - Paths: `openspec/changes/fix-c17-async-operation-id-validation/`.
- [x] T01.2 Preserve the existing `POST /v1/async-operation-query` route, trusted-caller boundary,
  query types, public response schemas, frontend client types, repository SQL, database migrations,
  roles/scopes, and observability design.
- [x] T01.3 Do not remediate any other audit finding and do not touch deployment/chart, cluster,
  loop-state, evidence, credentials, kubeconfigs, Playwright results, or agent/runtime assets.

## 2. Author the black-box acceptance first

- [x] T02.1 Before changing product source, add
  `tests/blackbox/async-operation-id-validation.test.mjs` through the action's public `main`
  entrypoint and demonstrate that it fails on `56566a7c` because malformed IDs reach a faithful
  PostgreSQL UUID predicate and surface as `22P02`/500.
- [x] T02.2 Cover `detail`, `logs`, and `result` with non-UUID, missing/blank, whitespace-only,
  number, null, array, object, truncated, unhyphenated, SQL-like, and overlong identifiers.
- [x] T02.3 Assert action `VALIDATION_ERROR`/400, zero database/repository calls, zero writes, zero
  successful access-audit publications, and zero structured completion log/metric annotations.
- [x] T02.4 Add controls for canonical unknown and foreign IDs returning scoped 404, canonical
  existing IDs returning their unchanged 200 projections and side effects, missing/untrusted
  identity returning 401, explicit valid cross-tenant filters returning 403, and list behavior
  remaining unchanged.

## 3. Validate at the action boundary

- [x] T03.1 In
  `packages/provisioning-orchestrator/src/actions/async-operation-query.mjs`, define one local
  canonical UUID predicate accepting case-insensitive hexadecimal `8-4-4-4-12` syntax without a
  UUID-version restriction.
- [x] T03.2 Extend `requireOperationId` so `detail`, `logs`, and `result` reject missing, blank,
  whitespace-only, non-string, and non-canonical identifiers with `VALIDATION_ERROR`/400 before
  `resolveTenantScope` or any repository call.
- [x] T03.3 Keep identity and query-type checks in their existing order, keep `list` exempt from
  the identifier requirement, and do not trim, stringify, or otherwise coerce invalid input.
- [x] T03.4 Leave repository SQL, response formatters, correlation selection, audit publication,
  structured logging, and metric annotations unchanged for valid requests.

## 4. Prove action and HTTP error contracts

- [x] T04.1 Add focused action/unit assertions where needed for the UUID boundary and the absence of
  database, audit, completion-log, metric, and write side effects on failure. Avoid duplicating the
  black-box matrix without adding a distinct contract proof.
- [x] T04.2 Add or extend a hermetic control-plane HTTP test using
  `createControlPlaneHttpServer` to prove a malformed authenticated request returns status 400 and
  a schema-valid C-02 `ErrorResponse` with public code `GW_VALIDATION_ERROR`, correlation/resource
  context, and no `22P02`, SQL, provider, or stack detail.
- [x] T04.3 Preserve controls for 401 authentication precedence, valid explicit cross-tenant 403,
  valid unknown/foreign 404, existing 200, and unchanged `list` behavior.
- [x] T04.4 Run the response-schema and trusted-context suites so the fix cannot weaken current
  response projections or header-derived tenant identity.

## 5. Prove persistence behavior locally

- [x] T05.1 Extend `tests/integration/async-operation-query-integration.test.mjs` to use its isolated
  real-PostgreSQL schema and migration chain for C-17 invalid, canonical unknown, and canonical
  existing operation IDs.
- [x] T05.2 Prove against real PostgreSQL that malformed IDs fail before a query, canonical unknown
  IDs return scoped 404, and an existing detail ID preserves its 200 projection; use the hermetic
  black-box matrix for all three projections, correlation, audit/log/metric, and read-only controls.
- [x] T05.3 Prove in the hermetic black-box matrix that an explicit valid cross-tenant filter retains
  403 before lookup and a valid foreign ID without a conflicting filter remains indistinguishable
  from an absent ID.
- [x] T05.4 Run `pnpm test:integration:async-operation-real-pg` with the repository's disposable
  local database harness. Do not use a Kubernetes or shared database.

## 6. Update directly relevant documentation

- [x] T06.1 Update `docs/reference/architecture/console-operations-polling.md` with the canonical
  identifier syntax, the query-type matrix, action-versus-HTTP error codes, 400/404 distinction,
  authentication/isolation behavior, absence of provider leakage, side-effect behavior, and focused
  verification commands.
- [x] T06.2 Keep general API, SDK, UI, installation, authentication, audit, and unrelated
  documentation unchanged.

## 7. Validate and run independent gates

- [x] T07.1 Run the dedicated C-17 black-box suite and focused async-operation unit, trusted-context,
  response-contract, C-11 result, C-13 list/status-array, console polling, and HTTP error-envelope
  regressions.
- [x] T07.2 Run the isolated real-PostgreSQL async-operation suite and record that no cluster was
  contacted.
- [x] T07.3 Run `openspec validate fix-c17-async-operation-id-validation --strict`, relevant
  repository validators, Markdown lint for changed Markdown, and `git diff --check`.
- [x] T07.4 Give independent journey, contract, authorization, verifier, documentation, and final
  reviewers only the task, diff, target SHA, and original reproduction. Resolve all blocking review
  findings before committing.
- [x] T07.5 Review the staged files and commit only C-17 product/spec/test/docs paths. Exclude
  loop-state, evidence, credentials, kubeconfigs, Playwright results, dependency artifacts, and all
  `.claude/`, `.codex/`, `.agents/`, and `.agent-runtime/` paths.

> Live deployment and Kubernetes verification are explicitly outside this change and SHALL NOT run.
