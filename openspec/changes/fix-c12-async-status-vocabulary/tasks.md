# Tasks: Unify the async-operation status vocabulary

## 1. Lock the C-12 boundary and failing acceptance cases

- [x] 1.1 Add focused pre-fix regressions that reproduce E6: migration 076/backend accept all seven
  statuses, the query-response and state-change schemas reject the three extended statuses, and the
  console type/presentation omits `cancelling`.
- [x] 1.2 Keep the implementation bounded to async-operation status vocabulary generation, the two
  internal schemas, generic backend classification, Operations console consumers, focused tests, and
  directly relevant documentation.
- [x] 1.3 Confirm the change adds no migration/DDL/data rewrite, transition edge, result
  reclassification, list-SQL semantic change, identifier-validation change, authorization/tenant
  change, telemetry vocabulary, route/OpenAPI/SDK change, or other-domain status change.
- [x] 1.4 Do not run or change cluster/deployment/chart state, loop-state/audit evidence, credentials,
  kubeconfigs, Playwright results, or agent-pack/runtime directories while implementing C-12.

## 2. Add the authoritative catalog and deterministic generator

- [x] 2.1 Create
  `packages/internal-contracts/src/async-operation-status-vocabulary.json` with the exact ordered
  seven entries, active/terminal/cancellable metadata, existing transition targets, Spanish labels,
  and bounded console tone tokens specified by the design.
- [x] 2.2 Create `scripts/generate-async-operation-status-vocabulary.mjs` using only deterministic
  Node core inputs. Validate all catalog invariants and render every expected output in memory before
  writing any changed file.
- [x] 2.3 Generate
  `packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs` with the
  ordered list, lifecycle subsets/sets, and transition map plus a generated-file warning.
- [x] 2.4 Generate
  `apps/web-console/src/lib/generated/async-operation-status-vocabulary.mjs` and its adjacent
  `.d.mts` declaration with ordered values, lifecycle arrays/sets, exact union types, labels, and
  tone tokens plus generated-file warnings.
- [x] 2.5 Make the generator own only the annotation and documented enum JSON pointers in
  `async-operation-query-response.json` and `async-operation-state-changed.json`; require those
  locations to exist and preserve all other schema semantics.
- [x] 2.6 Implement `--check` as a no-write exact-byte comparison that accumulates missing/stale paths,
  reports them in deterministic path order, and exits non-zero without repairing any file.
- [x] 2.7 In the same check, parse only executable SQL for the named migration-076 status constraint
  and active partial index; compare constraint order to the catalog and index membership to the
  generated active subset without modifying migration 076.
- [x] 2.8 Add root commands `generate:async-operation-status-vocabulary` and
  `validate:async-operation-status-vocabulary`, and include the no-write command in
  `validate:repo` so the existing CI lint job gates stale artifacts.
- [x] 2.9 Add a focused generator/source test covering valid invariants, malformed catalogs, managed
  JSON-pointer failures, repeated byte-identical rendering, one/multiple stale paths, deterministic
  reporting, SQL comment/ambiguity controls, and proof that check mode leaves isolated temporary
  files unchanged.

## 3. Consume generated lifecycle data in the backend

- [x] 3.1 Refactor
  `packages/provisioning-orchestrator/src/models/async-operation-states.mjs` into a behavior wrapper
  over the generated backend artifact while retaining existing exports and invalid-transition error
  code/message/metadata behavior.
- [x] 3.2 Keep `async-operation.mjs` creation, terminal write, cancellation, timeout, retry, and result
  lifecycle behavior unchanged while consuming the generated terminal/cancellable data through the
  existing model facade.
- [x] 3.3 Replace the query repository's local complete terminal set with the generated/model terminal
  classification for `completedAt`; leave semantically narrower timeout/orphan SQL subsets local.
- [x] 3.4 Expand backend state regressions to iterate every catalog transition, representative
  forbidden edges, all terminal members, all cancellable members, `cancelling` active/noncancellable
  behavior, and the unchanged `INVALID_TRANSITION` classification.
- [x] 3.5 Add static migration parity assertions proving the status constraint has exactly the seven
  canonical values in order and the active partial index has exactly pending/running/cancelling,
  while migration 076 remains byte-for-byte unedited by the change.

## 4. Generate and verify internal contract parity

- [x] 4.1 Regenerate `packages/internal-contracts/src/async-operation-query-response.json` so its one
  `OperationStatus` definition contains all seven values in canonical order and every list/detail/
  result reference receives the expansion without another schema-shape change.
- [x] 4.2 Regenerate `packages/internal-contracts/src/async-operation-state-changed.json` so both
  `previousStatus` and `newStatus` contain the identical seven values in canonical order, preserving
  every other field and event constraint.
- [x] 4.3 Extend `tests/contract/async-operation-query-response.test.mjs` to AJV-validate otherwise
  valid list, detail, and C-11-compatible result payloads for every generated status and reject an
  unknown status in every status-bearing branch.
- [x] 4.4 Extend `tests/contract/async-operation-state-changed.test.mjs` to AJV-validate every allowed
  graph edge, including timeout/cancelling/cancelled edges, and reject unknown previous/new values.
- [x] 4.5 Retain focused controls for operation cancel, timeout, and recovery event schemas, topics,
  required fields, status constraints, correlation, and publication behavior; do not replace their
  specialized constraints with the general enum.
- [x] 4.6 Add an exact parity assertion that both schema enum locations equal the authoritative
  ordered list and carry the generated-status annotation.

## 5. Preserve C-11 query result behavior

- [x] 5.1 Keep `completed` mapped to success, `failed` mapped to failure, and pending/running/
  timed_out/cancelling/cancelled mapped to the existing pending result type; do not alter the
  formatter's summary, failure reason, retryability, or raw-result exclusion.
- [x] 5.2 Cover stored/fallback `completedAt` for completed/failed/timed_out/cancelled and forced null
  completion time for pending/running/cancelling, including a cancelling row with stale storage.
- [ ] 5.3 Run the C-11 safe result, lifecycle write, retry clearing, saga, legacy fallback, and
  sensitive-content regressions unchanged after the terminal-set import.

## 6. Generate complete and accessible console presentation

- [x] 6.1 Make `apps/web-console/src/lib/console-operations.ts` import and re-export the generated
  `OperationStatus` facade instead of declaring a six-value union; update response/filter types only
  through that generated type.
- [x] 6.2 Render the Operations page status options from generated canonical values/labels after
  `Todos`, preserving scalar filter submission and pagination reset while adding
  `cancelling`/`Cancelando` in canonical order.
- [x] 6.3 Refactor `OperationStatusBadge` to use generated labels and bounded tones mapped to the
  existing dark-theme-safe design-system classes; render `Cancelando` as accessible text and do not
  rely on color or animation alone.
- [x] 6.4 Extend the Operations page and badge component tests to iterate all seven generated values,
  assert exact option order and selection behavior, assert `Cancelando` by accessible text, and
  retain existing dark-theme/loading/error/navigation controls.
- [ ] 6.5 Run console TypeScript checking to prove generated runtime/declaration parity and that every
  existing `OperationStatus` consumer accepts `cancelling` without an unsafe cast or fallback label.

## 7. Align console polling, count, reconnect, and reconciliation

- [x] 7.1 Replace the list polling predicate's pending/running literals with the generated active set;
  add fake-timer coverage showing pending/running/cancelling schedule the unchanged 30-second refresh
  and every terminal-only mixture stops it.
- [x] 7.2 Change the active-count hook to one existing C-13 list request using the generated active
  array and its union `total`; assert cancelling is counted once, terminals are excluded, zero stops
  polling, and existing error/cleanup/accessible indicator behavior remains intact.
- [x] 7.3 Change reconnect synchronization to send the generated active array
  `[pending, running, cancelling]` once per page under the existing tenant/workspace filters; retain
  pagination, debounce, visibility, session-expiry, abort, and no-per-status-fan-out behavior.
- [x] 7.4 Make reconciliation runtime and TypeScript declarations consume the generated terminal set
  and terminal union rather than local four-value literals.
- [x] 7.5 Add reconciliation cases for running-to-cancelling as updated/nonterminal, cancelling-to-
  cancelled and cancelling-to-failed as terminal, every other terminal status, idempotence, added/
  unchanged/unavailable behavior, and mixed snapshots.
- [x] 7.6 Update the reconnect contract/unit/tenant-isolation tests for the three-value active array
  while retaining C-13 parameterized membership, one request per page, pagination, and P13
  non-disclosure controls.

## 8. Prove persistence, filters, IDs, and cross-cutting compatibility

- [ ] 8.1 Extend the isolated real-PostgreSQL async-operation suite to apply the actual migration
  chain, persist/transition every canonical status through legitimate graph paths, and prove an
  unknown status is rejected by the migration-076 constraint.
- [ ] 8.2 Extend the real-PG C-13 multi-status regression with `cancelling` and prove scalar,
  singleton, union, order/duplicate, empty-array, count/item, pagination, parameterization, and
  tenant `AND` semantics remain unchanged.
- [x] 8.3 Run C-17 malformed/non-string/canonical unknown/foreign/existing ID controls and preserve
  authentication-first `401`, malformed `400`, explicit cross-tenant `403`, scoped unknown/foreign
  `404`, and existing `200` behavior.
- [x] 8.4 Add P10/P13 regression controls proving status expansion is read-only, grants no cancel or
  transition permission, remains under verified tenant predicates, and leaks no foreign row/count/
  existence information.
- [ ] 8.5 Preserve one correlation header, one access-audit event, one completion log, and current
  metrics per successful query request, with no raw result or new status-valued telemetry label;
  retain failure containment and sensitive-data controls.
- [ ] 8.6 Run route catalog, gateway, public OpenAPI/generated API, event topic/field, and SDK parity
  checks and confirm C-12 changes none of those surfaces.
- [ ] 8.7 Run focused tests for backup, flow, scheduling, webhook, tenant/workspace, plan, credential,
  retry-attempt, and other adjacent status models to confirm the async-operation generator does not
  rewrite or validate another domain vocabulary.

## 9. Document migration and operations posture

- [x] 9.1 Update `docs/reference/architecture/console-operations-polling.md` with the source path,
  exact canonical order, active/terminal/cancellable subsets, unchanged transition graph,
  migration-076 parity, schema coverage, and `Cancelando` presentation.
- [x] 9.2 Document the generation and no-write validation commands, generated output ownership,
  local/CI regression commands, and recovery action for a stale artifact for P3 and P17.
- [x] 9.3 Retain the existing C-11 result, C-13 list filtering/reconnect, C-17 identifier,
  authorization/isolation, polling retry, and no-provider-leak documentation without implying a
  route, OpenAPI, migration, or result-classification change.
- [x] 9.4 Keep `migration-and-rollback.md` aligned with the implementation: no forward/rollback DDL,
  migration 076 is immutable, generated source/output revisions roll forward/back together, and a
  partial mixed revision is blocked by the stale-artifact check.

## 10. Validate and review the bounded change

- [x] 10.1 Run generation once, then run it again and confirm no diff; run
  `pnpm validate:async-operation-status-vocabulary` and record a clean no-write parity result.
- [x] 10.2 Run focused backend state/model/query/event tests and internal-contract tests for every
  status, transition, C-11 result branch, migration parser, and unknown-value rejection.
- [ ] 10.3 Run focused web-console tests for type/runtime parity, filter/badge/P16 accessibility,
  polling/count, reconnect/reconciliation, tenant isolation, and TypeScript checking.
- [ ] 10.4 Run `pnpm test:integration:async-operation-real-pg` with the disposable local/CI database
  URL and confirm no cluster or shared database is contacted.
- [ ] 10.5 Run adjacent C-11, C-13, C-17, authentication, tenant-isolation, audit/logging/metrics,
  route/public-artifact, and other-domain regressions plus `pnpm validate:repo`.
- [x] 10.6 Run
  `openspec validate fix-c12-async-status-vocabulary --strict`, Markdown lint on changed Markdown,
  and `git diff --check`.
- [ ] 10.7 Review the final diff and confirm it contains only the authoritative catalog, generator/
  check wiring, generated backend/contract/console artifacts, focused consumers/tests/docs, and this
  OpenSpec package, with no migration, route/OpenAPI, deployment, loop-state/evidence, secret,
  kubeconfig, Playwright-result, or agent-pack change.

> Live deployment, Docker environment startup, Kubernetes verification, Playwright evidence, and
> loop-state/evidence updates are explicitly outside C-12 implementation and SHALL NOT be run.
