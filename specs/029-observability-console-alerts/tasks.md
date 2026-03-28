# Tasks: US-OBS-01-T05 — Console Health Summaries and Internal Degradation Alerts

**Input**: `specs/029-observability-console-alerts/spec.md`
**Feature Branch**: `029-observability-console-alerts`
**Task**: US-OBS-01-T05

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/029-observability-console-alerts/spec.md` with the focused console-alerts specification.
- [x] T002 Materialize `specs/029-observability-console-alerts/plan.md` with the contract, helper, documentation, validation, and verification strategy.
- [x] T003 Materialize `specs/029-observability-console-alerts/tasks.md` and keep it aligned with the actual bounded delta.

## Phase 2 — Console-alerts contract and helper implementation

- [x] T004 Add `services/internal-contracts/src/observability-console-alerts.json` covering the health summary model (supported scopes, status vocabulary, required fields, freshness threshold, aggregation rules, scope-isolation rules), the alert contract (categories, severity levels, lifecycle states, suppression defaults, oscillation detection, audience routing, required fields, masking policy), the audit context, and downstream-consumer declarations.
- [x] T005 Update `services/internal-contracts/src/index.mjs` so the console-alerts contract is available through `readObservabilityConsoleAlerts()`, `OBSERVABILITY_CONSOLE_ALERTS_VERSION`, and list/get accessors for scopes, alert categories, severity levels, lifecycle states, audience routing, aggregation rules, freshness threshold, and masking policy.
- [x] T006 Extend `apps/control-plane/src/observability-admin.mjs` with helpers: `buildHealthSummaryContext(scope, options)`, `buildAlertContext(categoryId, scope, options)`, `getAlertLifecycleStateMachine()`, `getAlertSuppressionDefaults()`, and `summarizeConsoleAlertsContract()`.
- [x] T007 Add `scripts/lib/observability-console-alerts.mjs` implementing `collectObservabilityConsoleAlertViolations()` and `scripts/validate-observability-console-alerts.mjs` as the thin validation runner.
- [x] T008 Update `package.json` scripts to expose `validate:observability-console-alerts` and wire it into `validate:repo` immediately after `validate:observability-business-metrics`.

## Phase 3 — Documentation and discoverability

- [x] T009 Add `docs/reference/architecture/observability-console-alerts.md` documenting the summary model (scopes, status vocabulary, aggregation rules, freshness handling), the alert contract (categories, severity, lifecycle, suppression semantics, audience routing), scope isolation and masking expectations for tenant and workspace consumers, and downstream-consumer guidance.
- [x] T010 Update `docs/reference/architecture/README.md` with two new entries: `services/internal-contracts/src/observability-console-alerts.json` as the machine-readable source of truth and `docs/reference/architecture/observability-console-alerts.md` as the human-readable companion, both attributed to `US-OBS-01-T05`.
- [x] T011 Update `docs/tasks/us-obs-01.md` with a `## Scope delivered in 'US-OBS-01-T05'` section summarizing key decisions and a residual scope note pointing to T06.

## Phase 4 — Tests and verification

- [x] T012 Add `tests/unit/observability-console-alerts.test.mjs` covering: health summary model accessors, alert category list and get helpers, lifecycle state machine and allowed transitions, suppression window defaults per category, `buildHealthSummaryContext()` output shape and scope-isolation enforcement, `buildAlertContext()` output shape and audience routing, and `summarizeConsoleAlertsContract()` output completeness.
- [x] T013 Add `tests/contracts/observability-console-alerts.contract.test.mjs` covering: contract version field is a non-empty string, `source_*_contract` version anchors align with current T01–T04 contract versions, all required summary scopes are present, status vocabulary contains required states with `operational_meaning` and `aggregation_priority`, all required alert categories are present with suppression window and routing, forbidden content categories are listed in masking policy, audience routing roles are valid against the authorization model, architecture doc and README index entries are discoverable, and `validate:observability-console-alerts` is wired into `validate:repo`.
- [x] T014 Run `npm run validate:observability-console-alerts`.
- [x] T015 Run targeted observability unit and contract tests.
- [x] T016 Run markdown lint on the touched documentation set.

## Phase 5 — Delivery

- [x] T017 Inspect the final diff to confirm the increment stayed within observability console-alerts contracts, helper summaries, docs, validation, and tests.
- [ ] T018 Commit the branch with a focused message for `US-OBS-01-T05`.
- [ ] T019 Push `029-observability-console-alerts` to `origin`.
- [ ] T020 Open a PR from `029-observability-console-alerts` to `main`.
- [ ] T021 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T022 Merge the PR to `main` once green.
- [ ] T023 Update orchestrator state files with the completed unit and next pending backlog item.
