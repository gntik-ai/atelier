# Change: Unify the async-operation status vocabulary

## Why

C-12 is confirmed by the E6 pre-edit reproduction. Persistence and the backend lifecycle accept
the ordered statuses `pending`, `running`, `completed`, `failed`, `timed_out`, `cancelling`, and
`cancelled`, but the async-operation query response and state-change event schemas accept only
`pending`, `running`, `completed`, and `failed`. The Operations console accepts six of the seven
durable values and omits `cancelling`. Valid timeout/cancellation lifecycle data can therefore fail
contract validation or fall outside the console type, filter, badge, polling, counting, reconnect,
and reconciliation behavior.

The duplicated lists can drift again because no single machine-readable source generates all three
layers or fails deterministically when a generated artifact is stale. Platform operators/SREs (P3)
and workspace operators/application DevOps users (P9) are the primary consumers. P10 remains a
constrained read-only caller; P1 and P7 are adjacent administrators; P13 is the safety and isolation
control; P16 requires an accessible rendered state; and P17 needs one documented vocabulary and
verification workflow.

## What Changes

- Add exactly one authoritative, machine-readable, ordered async-operation status catalog containing
  the seven values in migration-076 order:
  `pending`, `running`, `completed`, `failed`, `timed_out`, `cancelling`, `cancelled`.
- Record lifecycle metadata in that catalog: active states are `pending`, `running`, and
  `cancelling`; terminal states are `completed`, `failed`, `timed_out`, and `cancelled`; and only
  `pending` and `running` are cancellable. Record the existing transition graph and the Spanish
  console labels, including the accessible `cancelling` label `Cancelando`.
- Generate backend status constants/subsets/transition data, both internal JSON-schema status enums,
  and console runtime/type/label artifacts from the catalog. Hand-written consumers import the
  generated artifacts instead of maintaining another complete status definition.
- Keep migration `076-timeout-cancel-recovery.sql` unchanged and add a deterministic parity check
  proving its status constraint and active partial-index predicate match the catalog. Prove the
  generated transition graph retains the existing allowed and forbidden transitions.
- Expand every `OperationStatus` occurrence in the async-operation query response schema and both
  `previousStatus` and `newStatus` in the state-change event schema to all seven statuses.
- Add a deterministic generation command and a no-write stale-artifact check. The check recomputes
  byte-stable outputs without timestamps, fails non-zero with the exact stale paths, and is wired
  into repository validation/CI.
- Make the Operations console consume the generated type, ordered values, lifecycle subsets, and
  labels. Add `cancelling`/`Cancelando` to the status filter and badge, treat it as active for list
  polling and the active-operation indicator, and include it in reconnect and reconciliation.
- Preserve one parameterized C-13 status-array query per reconnect page while expanding its contents
  from the old partial active list to the generated active subset
  `pending`, `running`, `cancelling`. Keep scalar, singleton, multi-value, duplicate/order, and
  empty-array filtering semantics unchanged, and make reconciliation consume the generated active
  and terminal classifications rather than local status literals.
- Add backend, contract, generator-drift, migration-parity, console, accessibility, polling, count,
  reconnect, and reconciliation regressions, and update the focused Operations polling reference.

This is a backward-compatible contract expansion for lifecycle values already persisted and emitted;
it is not a route or response-shape break.

## Capabilities

### New Capabilities

- `async-operations`: Defines the canonical async-operation status vocabulary, generated cross-layer
  parity, lifecycle classifications, schema acceptance, console behavior, drift prevention, and
  compatibility constraints.

### Modified Capabilities

None. There is no archived `async-operations` base capability under `openspec/specs/`; the delta is
therefore introduced as a new capability and composes with the active C-11, C-13, and C-17 changes.

## Impact

- **Authoritative source and generation:** a new internal-contract status catalog, one deterministic
  Node generator/checker, root package commands, and CI/repository-validation wiring.
- **Backend:** generated lifecycle constants and transition data consumed by the existing
  async-operation state/model/query paths; no action route, persistence write, or transition change.
- **Contracts:** generated status enums in
  `async-operation-query-response.json` and `async-operation-state-changed.json`; no new field,
  event, topic, route, OpenAPI operation, or external API.
- **Console:** the Operations status type, filter, badge, polling decision, active count, reconnect
  query, and reconciliation classifiers consume generated values; rendered copy adds `Cancelando`.
- **Persistence:** no migration, DDL, backfill, constraint change, index change, or data rewrite.
  Existing migration 076 remains the database compatibility mirror and is checked, not regenerated.
- **Documentation/tests:** the focused Operations polling architecture reference and bounded
  backend/contract/console/generator regressions.

## Personas and Observable Outcomes

- **P3 — platform operator/SRE (primary):** can list, inspect, and validate operations in all seven
  durable states without a schema rejection and can run one deterministic drift check.
- **P9 — workspace operator/application DevOps (primary):** sees `cancelling` as the active,
  accessible `Cancelando` state; polling, active count, reconnect, and reconciliation do not lose it.
- **P10 — scoped viewer/auditor (constrained):** receives the corrected read-only status projection
  only under existing authorization and tenant scope, with no cancellation or mutation grant.
- **P1/P7 — adjacent administrators:** receive the same corrected vocabulary through existing query
  permissions; their roles, routes, and lifecycle powers do not expand.
- **P13 — safety/isolation control:** cannot use a status value, generated artifact, or filter array
  to bypass parameterization, authorization, tenant isolation, audit boundaries, or safe telemetry.
- **P16 — rendered-UI/accessibility:** can distinguish `Cancelando` in the filter and status badge by
  text available to assistive technology, without relying on color or animation alone.
- **P17 — documentation maintainer:** has one documented source, classifications, generation command,
  no-write drift command, and migration-parity rule instead of reconciling hand-maintained lists.

## Non-Goals

- No C-11 result persistence or projection change. `completed` remains success, `failed` remains
  failure, and every other status retains the existing C-11 `pending` result projection;
  domain-terminal `completedAt` handling and legacy fallback remain unchanged.
- No C-13 repository filtering change. Scalar equality, parameterized array membership, singleton
  equivalence, union/order/duplicate behavior, empty-array false semantics, `AND` composition,
  count/item predicate parity, ordering, and pagination remain unchanged.
- No C-17 operation-ID validation, `400`/`404` classification, or provider-detail handling change.
- No change to the transition graph, cancellation rules, timeout/recovery behavior, or specialized
  cancel/timeout/recovery event semantics.
- No authentication, authorization, role, scope, tenant-isolation, audit, logging, metrics, tracing,
  quota, or sensitive-data behavior change; no status-valued telemetry label is added.
- No route, HTTP method, response field, event field/topic, public OpenAPI, gateway, SDK, or generated
  public-API artifact change.
- No change to backup, flow, scheduling, webhook, tenant, workspace, plan, credential, or any other
  domain status vocabulary.
- No database migration, cluster/deployment/chart action, Docker/Kubernetes access, loop-state or
  evidence update, credential/kubeconfig access, Playwright-result update, or agent-pack change.

## Exit Criteria

- There is one authoritative ordered catalog with exactly the seven required unique values and no
  second hand-maintained complete runtime catalog.
- Generated backend, contract, and console artifacts are byte-stable and carry a generated header;
  generation twice produces identical bytes, and the no-write check fails with exact paths after a
  deliberate stale-artifact mutation.
- The backend exposes the canonical ordered list, active/terminal/cancellable subsets, and the
  unchanged transition graph from generated data.
- A parity regression proves migration 076 accepts exactly the seven catalog values and indexes
  exactly the three active values, without modifying the migration.
- Query list items, detail responses, and result responses validate for every status; state-change
  events validate for every endpoint of every existing allowed transition; unknown values fail.
- The console type, filter, badge, and accessible label cover all seven statuses in canonical order,
  with `cancelling` rendered and announced as `Cancelando`.
- `pending`, `running`, and `cancelling` keep list polling active and contribute to the active count;
  all four terminal states stop active polling and are excluded from that count.
- Reconnect retains one C-13 parameterized active-status array query per page and includes
  `cancelling`; reconciliation treats `cancelling` as a nonterminal update and classifies each of the
  four terminal values as terminal whenever it is present in a remote snapshot.
- C-11 result scenarios, C-13 status-filter scenarios, C-17 ID-validation scenarios, authorization,
  isolation, audit/log/metric, route/OpenAPI, and other-domain vocabulary regressions remain green.
- The focused architecture reference documents source, order, classifications, UI labels,
  generation/check commands, and the migration-076 parity rule.
- `openspec validate fix-c12-async-status-vocabulary --strict` passes.

## Risks and Rollback

The main risk is replacing obvious local literals with a generator that can silently leave stale
outputs. The no-write byte comparison is therefore mandatory in validation/CI, emits exact paths,
and carries no clock, locale, network, or filesystem-order input. A source-integrity regression
pins uniqueness, classifications, labels, and graph invariants, while parity tests independently
check the unchanged SQL mirror and actual schema validators.

The console risk is treating `cancelling` as terminal or omitting it from background behavior.
Focused fake-timer, count, reconnect, reconciliation, filter, badge, and accessibility tests cover
the status explicitly. Existing retry bounds and polling cadences remain unchanged.

Rollback reverts the catalog, generator/check wiring, generated artifacts, consumer imports,
console behavior, focused tests, documentation, and this OpenSpec package together. There is no
schema or data rollback. A partial rollback that leaves consumers and generated outputs from
different catalog revisions is rejected by the same stale-artifact check.
