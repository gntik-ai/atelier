# Design: Canonical async-operation status generation

## Context

See `proposal.md` for the confirmed C-12 mismatch. The relevant current implementation has four
different roles for status data:

- migration 076 is the deployed persistence compatibility boundary. Its `CHECK` constraint already
  accepts seven statuses and its partial index already identifies the three active statuses;
- `async-operation-states.mjs` contains the complete backend transition graph plus terminal and
  cancellable subsets;
- the query-response and state-change JSON schemas repeat a four-value historical enum; and
- the Operations console repeats a six-value TypeScript union and presentation/filter maps, while
  polling, count, reconnect, and reconciliation carry additional local subsets.

The migration and backend graph agree on behavior today, so C-12 is not a data-model or transition
repair. The design must remove future cross-layer drift while keeping migration 076, the transition
edges, C-11 result projection, C-13 list filtering, C-17 ID validation, and every cross-cutting
boundary stable. Generated files are committed build inputs; production startup must not generate
or mutate source files.

## Goals / Non-Goals

**Goals:**

- Establish one reviewable, machine-readable status source with stable order and lifecycle metadata.
- Generate backend, internal-contract, and console artifacts in a deterministic local command.
- Make stale output and migration/graph incompatibility fail before merge.
- Route generic backend and console classification through generated constants.
- Add `cancelling` to all Operations console behavior where an active state belongs.
- Keep the two internal schemas compatible with every status already persisted or emitted.

**Non-Goals:**

- Designing a general repository-wide enum framework or converting other domain vocabularies.
- Changing transition edges, cancel/timeout/recovery actions, result classification, list SQL,
  identifier validation, routes, public OpenAPI, authorization, or telemetry design.
- Generating or rewriting migration 076, adding a migration, or performing runtime code generation.
- Changing polling cadence, retry timing, pagination, reconnect triggers, or reconciliation output
  shape.

## Decision 1: Use one ordered JSON catalog as the sole authority

The authoritative input is
`packages/internal-contracts/src/async-operation-status-vocabulary.json`. It has a version marker and
one ordered `statuses` array. Each entry contains:

- `value` — the durable lower-snake-case value;
- `active`, `terminal`, and `cancellable` booleans;
- `transitions` — an ordered array of allowed target values;
- `consoleLabel` — the Spanish text rendered and announced by the Operations console; and
- `consoleTone` — a bounded presentation token such as `neutral`, `progress`, `success`, `danger`,
  or `warning`, not raw CSS.

The exact catalog is:

| Order | Value | Active | Terminal | Cancellable | Allowed targets | Console label | Tone |
| ---: | --- | :---: | :---: | :---: | --- | --- | --- |
| 1 | `pending` | yes | no | yes | `running`, `cancelled` | Pendiente | neutral |
| 2 | `running` | yes | no | yes | `completed`, `failed`, `timed_out`, `cancelling` | En curso | progress |
| 3 | `completed` | no | yes | no | none | Completada | success |
| 4 | `failed` | no | yes | no | none | Fallida | danger |
| 5 | `timed_out` | no | yes | no | none | Expirada | warning |
| 6 | `cancelling` | yes | no | no | `cancelled`, `failed` | Cancelando | progress |
| 7 | `cancelled` | no | yes | no | none | Cancelada | neutral |

The overall order intentionally matches the executable status constraint in migration 076. Derived
subsets preserve catalog order, yielding active `[pending, running, cancelling]`, terminal
`[completed, failed, timed_out, cancelled]`, and cancellable `[pending, running]`.

The generator validates the catalog before rendering: seven unique non-empty values, supported tone
and non-empty label, active XOR terminal for every entry, exhaustive classifications, cancellable as
an active-only subset, unique known transition targets, no terminal outgoing edge, and the exact
transition/cancellation invariants in `specs/async-operations/spec.md`. Validation finishes before
any output write, preventing a partially generated tree.

Alternatives rejected:

- **Keep a backend JavaScript file authoritative.** JSON schemas and TypeScript generation would
  need to execute product code and would mix backend behavior with neutral contract metadata.
- **Make migration 076 authoritative.** SQL cannot safely carry labels and transition metadata, and
  changing an already-deployed migration to evolve vocabulary is unsafe.
- **Keep one source per layer plus parity tests.** That detects some drift but leaves multiple files
  that reviewers can incorrectly treat as authorities.
- **Create a repository-wide status registry.** Other domains have distinct meanings and owners;
  combining them would expand C-12 and risk accidental vocabulary coupling.

## Decision 2: Generate bounded committed artifacts with a single Node command

`scripts/generate-async-operation-status-vocabulary.mjs` is the only generator. It uses Node core
APIs and the repository root derived from `import.meta.url`; it has no network access, environment
input, clock, locale sorting, random data, or dependency on the caller's working directory.

The default mode validates the source, renders all expected content in memory, and then writes only
changed outputs. `--check` performs the same render but writes nothing. Root package commands expose
the two supported entry points:

```text
pnpm generate:async-operation-status-vocabulary
pnpm validate:async-operation-status-vocabulary
```

The generated outputs are:

1. `packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs` — frozen
   ordered arrays, membership sets, label-free lifecycle subsets, and the transition map used by the
   backend;
2. the generated enum nodes in
   `packages/internal-contracts/src/async-operation-query-response.json` and
   `packages/internal-contracts/src/async-operation-state-changed.json`;
3. `apps/web-console/src/lib/generated/async-operation-status-vocabulary.mjs` — ordered arrays,
   membership sets, labels, and tone tokens for browser and runtime consumers; and
4. the adjacent generated `.d.mts` declaration — exact `OperationStatus`, active, terminal, and
   cancellable unions plus readonly value/map types for TypeScript consumers.

JavaScript outputs begin with a generated-file warning containing the source and generation command.
Because JSON does not allow comments, each managed schema carries an
`x-falcone-generated-status-vocabulary` annotation naming the source and command. The generator owns
only the schema annotation and these JSON pointers:

- query response: `/definitions/OperationStatus/enum`;
- state change: `/properties/previousStatus/enum`; and
- state change: `/properties/newStatus/enum`.

It parses the current JSON, requires each managed location to exist with the expected schema shape,
replaces the managed values, and serializes with the repository's fixed two-space JSON formatting
and one final newline. The rest of each schema remains hand-maintained. This avoids duplicate full
schema templates while still making the status-bearing contract nodes generated artifacts.

Render order and report order are hard-coded path order. String output uses `\n` regardless of host;
JSON object construction and emitted maps follow catalog order. No generated timestamp is allowed.
The generator first computes every output, then writes changed files, so a source validation or
render failure cannot leave a partial set.

Alternatives rejected:

- **Generate during service or console startup.** Runtime mutation is unsafe, complicates immutable
  images, and lets deployments disagree with reviewed source.
- **Use external JSON-schema `$ref` to a generated enum schema.** Existing standalone AJV consumers
  compile the response and event documents without registering another schema; external references
  would create an unnecessary loading contract.
- **Duplicate full contract templates.** It would make every non-status schema edit occur in a
  template/output pair and substantially widen this focused repair.
- **Generate TypeScript only.** The reconciliation runtime is directly exercised as `.mjs`; a
  paired runtime/declaration output keeps Node tests and browser type-checking on the same source.

## Decision 3: Make check mode a deterministic stale-artifact and compatibility gate

Check mode compares the exact expected UTF-8 bytes with every committed output. Missing files and
byte differences are accumulated and printed in deterministic path order, then the process exits
non-zero. It never invokes the write branch. A successful check prints a bounded confirmation and
exits zero.

The same command also performs two read-only compatibility validations that cannot be generated
away:

- extract the executable `async_operations_status_check` `IN (...)` values from migration 076 and
  compare their ordered values to the catalog; and
- extract `idx_async_ops_status_updated`'s executable `WHERE status IN (...)` values and compare its
  set with the generated active subset.

The extraction is deliberately anchored to the constraint and index names and their executable SQL,
not rollback comments or a repository-wide string search. Failure to identify exactly one matching
constraint/index is itself an error. Set comparison is correct for the index predicate because SQL
`IN` order has no semantics; order comparison is retained for the canonical migration constraint.

The backend transition graph does not need a second parser: it is emitted directly from catalog
`transitions`, and byte comparison makes stale generated graph data fail. Focused backend tests
exercise every allowed and representative forbidden edge through the public validator, giving
behavioral proof in addition to generation proof.

`validate:async-operation-status-vocabulary` is inserted into `validate:repo`, which is already run
by CI through `pnpm lint`. A focused generator test renders twice, compares bytes, uses an isolated
temporary output set to demonstrate one and multiple stale-path reports, and verifies that check
mode leaves the temporary files unchanged. It also covers malformed catalog invariants and migration
extraction failures.

Alternatives rejected:

- **Regenerate and rely on `git diff --exit-code` in CI.** That mutates the checkout, reports
  unrelated dirt, and can conceal which artifacts belong to this generator.
- **Compare parsed values only.** It would permit formatting and declaration drift between committed
  artifacts and generated output and would not prove repeatable byte output.
- **Rewrite migration 076 from the catalog.** Historical migrations remain immutable compatibility
  boundaries; a read-only parity assertion is the safe control.

## Decision 4: Route backend classification and transitions through generated data

The hand-written `models/async-operation-states.mjs` becomes a small behavior wrapper over the
generated backend artifact. It continues to export the current names `VALID_TRANSITIONS`,
`TERMINAL_STATES`, and `CANCELLABLE_STATES`, plus `isTerminal`, `isCancellableState`, and
`validateTransition`, so callers do not receive a module-contract migration. Error code, message
shape, `current`, and `next` metadata remain compatible.

`async-operation.mjs` continues to consume those public model exports. The query repository replaces
its local complete terminal literal with the same generated/model terminal set for `completedAt`
projection. Specialized SQL subsets remain local when their semantics are not the generic active,
terminal, or cancellable classification—for example timeout candidates intentionally distinguish
pending/running work from stale cancelling work. Test fixtures may name statuses needed by a
scenario; they are assertions, not runtime authorities.

This decision preserves the current graph exactly. It does not make the backend accept arbitrary
catalog changes automatically without review: migration parity, source invariants, graph tests,
contracts, console tests, and strict OpenSpec validation all gate a catalog revision.

## Decision 5: Generate the two internal schema enum locations without changing shape

The query response's single `OperationStatus` definition is expanded to the seven generated values,
so its list-item, detail, and result references converge automatically. No `oneOf` branch, required
field, format, or `additionalProperties` rule changes.

Both direct enums in the state-change event receive the same generated seven values. The schema
continues to validate fields independently; the backend graph remains the authority for whether a
pair is a legal transition. Generating a `oneOf` for every legal pair was rejected because it would
change the event schema's responsibility and could reject historical/diagnostic payloads that the
current field-enum contract permits.

Contract regressions use AJV, not the events module's required-field helper alone. Query tests build
otherwise valid list, detail, and result payloads for every generated status and reject an unknown.
State-change tests build every allowed transition event and reject unknown `previousStatus` and
`newStatus` values. Existing cancel, timeout, and recovery contracts remain specialized and are not
rewritten into the seven-value general enum.

## Decision 6: Preserve C-11 result classification while sharing terminal membership

The C-12 enum expansion is deliberately independent of result semantics:

| Status | C-11 `resultType` | `completedAt` membership |
| --- | --- | --- |
| `pending` | `pending` | nonterminal: always null |
| `running` | `pending` | nonterminal: always null |
| `completed` | `success` | terminal: stored value or legacy fallback |
| `failed` | `failure` | terminal: stored value or legacy fallback |
| `timed_out` | `pending` | terminal: stored value or legacy fallback |
| `cancelling` | `pending` | nonterminal: always null |
| `cancelled` | `pending` | terminal: stored value or legacy fallback |

Only the enum source and terminal membership import change. The result formatter's classification
branches, summary/failure/retryability guards, safe result persistence, raw-result exclusion, and
legacy `updated_at` fallback remain untouched. Focused C-11 tests cover all seven status rows so a
future cleanup cannot silently reinterpret timeout or cancellation under C-12.

Changing `timed_out` and `cancelled` to failure was rejected even though they are terminal: that is a
separate result-contract decision and would violate the explicit C-11 compatibility boundary.

## Decision 7: Make Operations console consumers import the generated facade

The generated console runtime/declaration exports:

- `OPERATION_STATUSES` and the `OperationStatus` union;
- ordered active, terminal, and cancellable arrays plus membership sets;
- `OPERATION_STATUS_LABELS`; and
- `OPERATION_STATUS_TONES` with a small fixed tone union.

`console-operations.ts` imports and re-exports the generated `OperationStatus` type to preserve its
current import facade for existing components. Its list polling predicate uses the generated active
set. The active-count hook issues one existing C-13 list request with the generated active array and
uses the returned union `total`, eliminating per-status drift and counting each active row once.
That request retains the existing read-only query path and therefore one existing audit/log/metric
set for that request; no new side effect or status-valued metric label is added.

`ConsoleOperationsPage` renders filter options by mapping `OPERATION_STATUSES` through generated
labels after `Todos`. `OperationStatusBadge` renders the generated label and maps the bounded tone to
the existing dark-theme-safe class bundle. The `progress` tone may retain the current active visual
treatment, but `Cancelando` is always rendered as text, making the state understandable without
color or animation. A component regression queries the accessible text rather than inspecting color
alone.

`reconcile-operations.runtime.mjs` imports the generated terminal set; its declaration/TypeScript
facade imports the generated terminal type rather than spelling a four-value `Extract`. The banner's
sentence fragments remain hand-authored presentation copy for terminal outcomes, not an
authoritative status catalog.

Keeping a hand-written `Record<OperationStatus, ...>` for labels/styles was rejected because it
would recreate a seven-key source that can omit `cancelling`. Raw CSS in the neutral catalog was
also rejected; bounded tones keep design-system class choices in the component.

## Decision 8: Expand reconnect only to the canonical active subset

Reconnect keeps the C-13 design: one paginated list request carrying one parameterized status array,
plus the existing tenant/workspace filters. The hard-coded `['running', 'pending']` array becomes the
generated active array `[pending, running, cancelling]`. Repository membership is order-invariant,
so canonical ordering changes no C-13 selection semantics. There is no request fan-out by status.

The active-only query remains intentional. C-12 does not redesign reconnect into a full history
download or add per-operation detail fan-out. `reconcileOperations` nevertheless uses the generated
terminal set whenever its caller provides terminal rows, preserving its public classification
behavior and covering all four terminal states. Its existing missing-remote `unavailable` behavior
is not reinterpreted.

Focused tests add:

- a reconnect request assertion for the three generated active values under tenant/workspace scope;
- a running-to-cancelling reconciliation case that is updated but nonterminal;
- a cancelling-to-cancelled/failed case and direct cases for every terminal value;
- pagination, one-request-per-page, debounce, visible-tab, authentication-expiry, abort, and tenant
  isolation controls; and
- the existing C-13 real-PostgreSQL array membership suite with `cancelling` in the multi-status
  union.

Downloading all seven statuses during reconnect was rejected as potentially unbounded historical
work and as a change to C-13's active-sync purpose. Per-ID lookups for missing active rows were
rejected as N+1 traffic and a broader C-17/reconciliation redesign.

## Decision 9: Layer regressions without using deployment evidence

Verification is split by responsibility:

- **Generator/source unit:** catalog invariants, byte repeatability, stale-path/no-write behavior,
  managed JSON pointers, and migration-076 static parity.
- **Backend unit:** exact allowed graph, forbidden edges, terminal and cancellable membership, and
  unchanged error classification.
- **Internal contract:** AJV validation for all query placements and all state-change graph edges;
  unknown-value rejection and specialized-event controls.
- **Real PostgreSQL:** the existing isolated async-operation suite applies the real migration chain,
  transitions through the real repository, proves all seven stored statuses are accepted and an
  unknown is rejected by the constraint, and retains C-11/C-13/C-17 scenarios.
- **Console unit/component:** generated type/runtime parity, canonical filter order, `Cancelando`
  accessible badge, fake-timer polling, active total, reconnect request, and reconciliation.
- **Compatibility:** existing authorization/tenant, audit/log/metric, query response, route/public
  artifact, and other-domain suites run unchanged or receive only focused assertions.
- **Documentation:** `docs/reference/architecture/console-operations-polling.md` records the source,
  meanings, UI label, generator, no-write check, and migration mirror.

The real-PostgreSQL suite uses its disposable local/CI database URL and never a cluster. No
Playwright run or artifact is necessary: P16's requirement is covered by rendered component tests
using accessible roles/text, and the task explicitly excludes Playwright-result changes.

## Risks / Trade-offs

- **[Risk] The generator owns only bounded enum nodes in otherwise hand-written JSON schemas.** → It
  validates exact JSON pointers and annotations, canonicalizes output, and contract tests compile the
  complete schemas; non-status schema evolution remains independent.
- **[Risk] Committed generated files can be edited manually.** → `--check` is no-write, byte-exact,
  runs in `validate:repo`/CI, lists all stale paths, and generated headers name the repair command.
- **[Risk] SQL extraction could match rollback comments or an unrelated `IN` clause.** → Extraction
  anchors to the executable named constraint/index, strips SQL comments for comparison, requires one
  match, and has malformed/ambiguous fixture tests.
- **[Risk] Adding `cancelling` to active behavior can create endless browser traffic.** → It uses the
  existing active cadence and bounded retry/cleanup logic; migration 076 already treats cancelling
  as active for orphan/index purposes, and terminal cancellation stops the timer.
- **[Risk] One active-count array request changes the current two-request implementation.** → C-13
  already guarantees array union and count/item parity; the response `total`, UI copy, authorization,
  and per-request side effects remain the same while the count now includes cancelling once.
- **[Risk] Generated console declarations and runtime could disagree.** → Both are emitted in one
  in-memory generation pass, checked byte-for-byte together, then covered by TypeScript and runtime
  tests.
- **[Risk] A future eighth status requires more than catalog editing.** → Migration compatibility,
  graph/source invariants, schema, console, docs, and regression gates fail until an explicit change
  resolves persistence and behavioral semantics.

## Migration Plan

There is no database migration or data transformation.

1. Add the catalog, generator, package commands, and generated outputs in one revision.
2. Replace backend and console complete/subset authorities with imports from generated artifacts,
   retaining current public module exports where callers depend on them.
3. Regenerate both internal schema enum locations and add focused regressions/documentation.
4. Run the no-write generation/parity check, backend/contract/console tests, the isolated real-PG
   suite, adjacent C-11/C-13/C-17 controls, repository validation, Markdown lint, and strict OpenSpec
   validation before merge.
5. Deploy as an ordinary application/console revision. Generated assets are already committed and
   bundled; startup performs no generation and the database remains unchanged.

Rollback reverts the catalog, generator commands, generated outputs, consumer imports, focused
tests, documentation, and this OpenSpec package together. Migration 076 and stored rows remain
untouched. A partial rollback or cherry-pick that mixes catalog/output revisions fails the no-write
check and is not releaseable.
