# async-operations — spec delta for fix-c12-async-status-vocabulary

## Purpose

Defines one canonical async-operation lifecycle vocabulary and requires persistence, backend,
internal contracts, and the Operations console to expose the same statuses and classifications
without changing adjacent result, filtering, identifier, authorization, or observability semantics.

## ADDED Requirements

### Requirement: Single authoritative async-operation status catalog

The system SHALL define exactly one authoritative, machine-readable async-operation status catalog
that enumerates the status vocabulary in a fixed order and records its lifecycle classifications,
transition graph, and console labels. The catalog SHALL contain exactly the seven persisted values
in migration-076 order — `pending`, `running`, `completed`, `failed`, `timed_out`, `cancelling`,
`cancelled` — with no duplicate, missing, or extra value. The catalog SHALL record the active subset
`{pending, running, cancelling}`, the terminal subset `{completed, failed, timed_out, cancelled}`,
the cancellable subset `{pending, running}`, the existing transition graph, and the Spanish console
label for every status including `cancelling → Cancelando`. No second hand-maintained complete
status vocabulary SHALL remain in the backend, contracts, or console.

#### Scenario: Catalog enumerates the seven ordered values

- **WHEN** the authoritative catalog is read
- **THEN** it lists exactly `pending`, `running`, `completed`, `failed`, `timed_out`, `cancelling`,
  and `cancelled` in that order, with each value unique and no other value present

#### Scenario: Catalog records lifecycle classifications

- **WHEN** the catalog's lifecycle subsets are read
- **THEN** the active subset is exactly `{pending, running, cancelling}`, the terminal subset is
  exactly `{completed, failed, timed_out, cancelled}`, and the cancellable subset is exactly
  `{pending, running}`, and every status belongs to exactly one of active or terminal

#### Scenario: Catalog records the cancelling label

- **WHEN** the catalog's console labels are read
- **THEN** every status has a non-empty Spanish label and `cancelling` maps to `Cancelando`

#### Scenario: No competing hand-maintained vocabulary remains

- **WHEN** the backend domain model, the internal contract schemas, and the console vocabulary are
  inspected
- **THEN** each derives its status vocabulary and classifications from the generated catalog
  artifacts rather than re-declaring a second complete list

### Requirement: Derived status artifacts are generated and drift-guarded

The backend status constants and subsets, the internal JSON-schema status enums, and the console
type, values, subsets, and labels SHALL be generated from the authoritative catalog by a
deterministic command, and hand-written consumers SHALL import the generated artifacts. Generation
SHALL be byte-stable and SHALL take no clock, locale, network, or filesystem-order input, so that
generating twice produces identical bytes. A no-write drift check SHALL recompute the artifacts and,
when any generated file is stale, SHALL exit non-zero and report the exact stale paths; it SHALL be
wired into repository validation so a stale artifact cannot merge.

#### Scenario: Regeneration is byte-identical

- **WHEN** the generation command runs twice against an unchanged catalog
- **THEN** every generated artifact is byte-for-byte identical on both runs and carries a
  generated provenance marker (a comment header for code or an annotation for JSON)

#### Scenario: Stale artifact fails the check with exact paths

- **WHEN** a generated artifact is deliberately edited to disagree with the catalog and the no-write
  drift check runs
- **THEN** the check exits non-zero, does not rewrite any file, and names the exact stale path

#### Scenario: Consumers import the generated artifacts

- **WHEN** the backend domain model, the two contract schemas, and the console vocabulary are built
- **THEN** each consumes the generated catalog artifacts, so adding or renaming a status in the
  catalog propagates to every layer through regeneration

#### Scenario: Drift check runs in repository validation

- **WHEN** repository validation runs
- **THEN** the async-operation status drift check runs and fails the validation if any generated
  artifact is stale

### Requirement: Migration 076 remains the unchanged database mirror and is parity-checked

The database schema SHALL NOT change. Migration
`packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql` SHALL remain
byte-unchanged and SHALL continue to be the database mirror of the catalog. A deterministic parity
check SHALL prove, without modifying the migration, that the `async_operations_status_check`
constraint accepts exactly the seven catalog values, that the `idx_async_ops_status_updated` partial
index predicate lists exactly the three active values, and that the generated transition graph
preserves the existing allowed transitions and continues to forbid the transitions rejected today.

#### Scenario: Status constraint matches the catalog

- **WHEN** the parity check reads migration 076's status CHECK constraint
- **THEN** the constraint accepts exactly the seven catalog values and no others, and the migration
  file is not modified

#### Scenario: Active partial index matches the active subset

- **WHEN** the parity check reads the `idx_async_ops_status_updated` predicate
- **THEN** the predicate lists exactly `running`, `pending`, and `cancelling`, matching the catalog's
  active subset

#### Scenario: Transition graph invariants are preserved

- **WHEN** the parity check compares the generated transition graph with the existing behavior
- **THEN** every transition allowed today (including `pending → running`, `pending → cancelled`,
  `running → completed`, `running → failed`, `running → timed_out`, `running → cancelling`,
  `cancelling → cancelled`, and `cancelling → failed`) remains allowed, every terminal state has no
  outgoing transition, and a transition rejected today remains rejected

### Requirement: Async-operation query responses accept every persisted status

The async-operation query-response contract's `OperationStatus` enum SHALL accept all seven catalog
values, so list-item, detail, and result projections validate for every status the backend can
persist and emit. An unrecognized status value SHALL still fail validation. This change SHALL NOT
alter any response field, shape, route, or the separate C-11 `resultType`/`completedAt` projection.

#### Scenario: Detail response validates for extended statuses

- **WHEN** a `detail` response carries `status` `timed_out`, `cancelling`, or `cancelled`
- **THEN** it validates against the query-response contract instead of being rejected as an unknown
  status

#### Scenario: List and result responses validate for extended statuses

- **WHEN** a `list` item or a `result` response carries any of the seven statuses
- **THEN** it validates against the contract, and the C-11 `resultType` and `completedAt` fields are
  projected exactly as before

#### Scenario: Unknown status is rejected

- **WHEN** a response carries a status that is not one of the seven catalog values
- **THEN** contract validation fails

### Requirement: Async-operation state-change events accept every real transition endpoint

The async-operation state-change event contract's `previousStatus` and `newStatus` enums SHALL
accept all seven catalog values, so an event for any existing allowed transition validates. An
unrecognized status value SHALL still fail validation. No event field, topic, or shape SHALL change.

#### Scenario: Cancellation and timeout transition events validate

- **WHEN** a state-change event describes `running → cancelling`, `cancelling → cancelled`,
  `cancelling → failed`, `running → timed_out`, or `pending → cancelled`
- **THEN** both `previousStatus` and `newStatus` validate against the event contract

#### Scenario: Unknown transition endpoint is rejected

- **WHEN** a state-change event carries a `previousStatus` or `newStatus` outside the seven catalog
  values
- **THEN** contract validation fails

#### Scenario: Event shape is unchanged

- **WHEN** the state-change event contract is compared before and after the change
- **THEN** only the `previousStatus` and `newStatus` enums are widened and no field, topic, or
  required-property set is altered

### Requirement: Console renders, labels, and filters every status accessibly

The Operations console SHALL consume the generated status vocabulary and labels so that its status
type, status badge, and status filter cover all seven statuses in canonical order. Every status
SHALL render a non-empty, styled badge, and `cancelling` SHALL render and be announced as
`Cancelando`. No status SHALL render a blank, label-less, or color-only badge, so a status is
distinguishable by text available to assistive technology rather than by color or animation alone.
The status filter SHALL offer every status, including `cancelling`.

#### Scenario: Cancelling renders an accessible labeled badge

- **WHEN** the P9 or P16 persona views an operation whose status is `cancelling`
- **THEN** the badge shows the visible text label `Cancelando` with a distinct style, and the label
  is available to assistive technology rather than conveyed by color or animation alone

#### Scenario: Every status has a badge label and style

- **WHEN** the status badge is rendered for each of the seven statuses
- **THEN** each renders a non-empty Spanish label and a defined style, and no status yields a blank
  or unstyled badge

#### Scenario: Status filter offers cancelling

- **WHEN** the P3 persona opens the operation-list status filter
- **THEN** the filter offers every catalog status in canonical order, including a `cancelling`
  option labeled `Cancelando`

### Requirement: Non-terminal operations stay active across polling, counting, reconnect, and reconciliation

The console SHALL classify an operation as active when its status is in the generated active subset
`{pending, running, cancelling}`. A `cancelling` operation SHALL keep list polling active and SHALL
contribute to the active-operation indicator, and all four terminal states SHALL stop active polling
and be excluded from the active count. The reconnect state sync SHALL carry the generated active
subset in a single parameterized list query per page — preserving the C-13 query mechanism while
expanding its contents to include `cancelling`. Reconciliation SHALL treat a `cancelling` change as a
non-terminal update and SHALL classify each of the four terminal values as terminal.

#### Scenario: Cancelling keeps list polling active

- **WHEN** an operation list contains an operation whose status is `cancelling`
- **THEN** the list continues its active-operations polling instead of stopping as if all operations
  had settled

#### Scenario: Active count includes cancelling

- **WHEN** the active-operation indicator is computed
- **THEN** its count includes `pending`, `running`, and `cancelling` operations, counts each active
  operation once, and excludes the four terminal states

#### Scenario: Reconnect query carries the active subset in one request

- **WHEN** the P9 reconnect sync runs
- **THEN** it issues one parameterized list query per page carrying the active-status array
  `['pending', 'running', 'cancelling']` and is not split into one request per status value

#### Scenario: Reconciliation treats cancelling as a non-terminal update

- **WHEN** reconciliation observes a remote operation transition to `cancelling`
- **THEN** the operation is classified as an `updated` (non-terminal) delta, while transitions to
  `completed`, `failed`, `timed_out`, or `cancelled` are classified as terminal

### Requirement: Terminal classification derives from one catalog and is applied consistently

The terminal subset `{completed, failed, timed_out, cancelled}` SHALL be derived from the
authoritative catalog and consumed by every console site that distinguishes terminal from
non-terminal operations, including reconciliation, the terminal-transition summary, the
polling-stop decision, and the active-count exclusion. `cancelling` SHALL never be classified as
terminal in any console site.

#### Scenario: Terminal transition stops polling and is summarized

- **WHEN** an operation transitions to any of `completed`, `failed`, `timed_out`, or `cancelled`
- **THEN** the console classifies it as terminal, stops its active polling, and can summarize the
  terminal transition

#### Scenario: Cancelling is never terminal

- **WHEN** any console site evaluates whether a `cancelling` operation is terminal
- **THEN** it is classified as non-terminal in every such site, consistent with the single catalog

### Requirement: The vocabulary change preserves siblings, authorization, isolation, routes, and telemetry

The status-vocabulary reconciliation SHALL NOT change C-11 result persistence or projection, the
C-13 repository status-filter binding, C-17 identifier validation, the transition graph, or the
cancellation/timeout/recovery behavior. It SHALL NOT change any route, HTTP method, response field,
event field or topic, public OpenAPI, gateway policy, SDK, or generated public-API artifact, and it
SHALL NOT change any other domain's status vocabulary. Authentication, authorization, roles, scopes,
tenant isolation, audit, logging, metrics, and quota SHALL be unchanged, status values SHALL remain
bound parameters that cannot alter a query, and the query SHALL remain read-only.

#### Scenario: Sibling contracts remain green

- **WHEN** the C-11 result scenarios, the C-13 status-filter scenarios, and the C-17
  identifier-validation scenarios run after the change
- **THEN** each remains green, unaffected by the vocabulary reconciliation

#### Scenario: Isolation and injection controls hold

- **WHEN** the P13 persona supplies a status value, a status array, or a manipulated generated
  artifact
- **THEN** it cannot bypass parameterization, authorization, tenant isolation, audit boundaries, or
  safe telemetry, and it cannot alter query structure or read another tenant's operations

#### Scenario: Read-only projection under existing authorization

- **WHEN** the P10 constrained viewer reads an operation in any of the seven statuses
- **THEN** the corrected status is returned only under the caller's existing authorization and tenant
  scope, with no cancellation or mutation capability granted and no write performed

#### Scenario: Other domains and routes are untouched

- **WHEN** the backup, flow, scheduling, webhook, tenant, workspace, plan, and credential status
  vocabularies and the async-operation routes and response shapes are compared before and after
- **THEN** they are unchanged, and only the async-operation status enums and console classification
  are reconciled

### Requirement: Operations documentation reflects the reconciled vocabulary

The focused Operations polling architecture reference SHALL document the authoritative source, the
ordered vocabulary, the active/terminal/cancellable classifications, the console labels including
`Cancelando`, the generation and no-write drift commands, and the migration-076 parity rule. It
SHALL define an active operation as any non-terminal status — `pending`, `running`, or `cancelling`
— consistent with the catalog. No unrelated documentation SHALL change.

#### Scenario: Documentation enumerates the vocabulary and active classification

- **WHEN** the P17 documentation maintainer reads the Operations polling reference
- **THEN** it enumerates the seven ordered statuses, defines active as the non-terminal set
  `{pending, running, cancelling}`, lists the terminal set, and shows the `Cancelando` label

#### Scenario: Documentation names the generation, drift, and parity workflow

- **WHEN** the P17 maintainer needs to change the vocabulary
- **THEN** the reference names the single authoritative catalog, the deterministic generation
  command, the no-write drift check, and the migration-076 parity rule as the one workflow, with no
  hand-maintained per-layer list
