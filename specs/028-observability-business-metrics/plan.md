# Implementation Plan: US-OBS-01-T04 — Business and Product Metrics in the Observability Plane

**Branch**: `028-observability-business-metrics` | **Date**: 2026-03-28 | **Spec**: `specs/028-observability-business-metrics/spec.md`
**Task**: US-OBS-01-T04 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task is the fourth observability increment for the platform.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 028,
2. add one machine-readable internal contract that defines the canonical business/product metrics
   vocabulary for the observability plane,
3. keep that contract aligned with the technical observability baseline by reusing the same scope,
   naming, masking, and bounded-cardinality conventions,
4. expose the new contract through shared internal readers and control-plane observability helper
   summaries,
5. add deterministic validation and human-readable architecture documentation,
6. update the task summary for `US-OBS-01`,
7. add targeted unit and contract coverage in the dedicated test stage,
8. and deliver the change through the normal branch, PR, CI, and merge flow.

This increment does **not** implement dashboards, alert thresholds, console widgets, smoke tests,
or commercial billing logic. It defines and materializes the canonical business metrics baseline that
later observability, quota, metering, and console work must consume.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON internal contracts, Markdown docs.
**Primary dependencies**: existing observability metrics-stack, dashboard, and health-check
baselines; shared internal-contract readers; Node test runner; markdownlint.
**Storage**: N/A — no database schema or persistence migration.
**Testing**: `node --test` unit and contract coverage plus dedicated repo validation scripts.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/028-observability-business-metrics/spec.md`
- `specs/028-observability-business-metrics/plan.md`
- `specs/028-observability-business-metrics/tasks.md`
- `services/internal-contracts/src/observability-business-metrics.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `scripts/lib/observability-business-metrics.mjs`
- `scripts/validate-observability-business-metrics.mjs`
- `docs/reference/architecture/observability-business-metrics.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-01.md`
- `tests/unit/observability-business-metrics.test.mjs`
- `tests/contracts/observability-business-metrics.contract.test.mjs`
- `package.json`

**Constraints**:

- preserve `US-OBS-01-T01` as the authoritative naming, labeling, scope, and collection-freshness
  baseline,
- remain compatible with dashboard scope semantics from `US-OBS-01-T02`,
- remain compatible with health/freshness semantics from `US-OBS-01-T03`,
- keep the increment additive and reusable by `US-OBS-01-T05`, `US-OBS-01-T06`, and future quota /
  metering work,
- keep business metrics clearly distinct from infrastructure-only signals,
- preserve multi-tenant isolation, safe masking, and bounded-cardinality rules.

---

## Architecture / Content Strategy

### 1. Dedicated business-metrics contract as the source of truth

Add `services/internal-contracts/src/observability-business-metrics.json` as the machine-readable
source of truth for:

- business metric domains and families,
- type distinctions between adoption, lifecycle, and usage-oriented metrics,
- supported scope rules for platform, tenant, and workspace views,
- required labels and safe bounded dimensions,
- forbidden high-cardinality or sensitive labels,
- metric-family alignment with the existing observability plane,
- downstream consumer expectations for summaries, metering, and quota use,
- and audit, masking, and freshness expectations.

This keeps the product-observability baseline explicit and contract-first without conflating it with
dashboard or billing implementation.

### 2. Reuse the existing observability-plane conventions instead of inventing parallel rules

The new contract should not redefine scope, query isolation, or freshness semantics. Instead it
should explicitly align with:

- the `platform` / `tenant` / `workspace` scope model from the metrics-stack and dashboard
  contracts,
- the same naming prefix and required-label conventions,
- the same bounded-cardinality philosophy,
- and the same stale/missing evidence cautions used by the broader observability plane.

### 3. Shared readers and control-plane helpers remain read-only and summary-oriented

Update `services/internal-contracts/src/index.mjs` so downstream code can read the business metrics
contract, list metric domains/families, and retrieve safe metric metadata.

Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers that:

- summarize the business metrics baseline,
- expose business metric domains and supported scopes,
- build safe query-context summaries for platform, tenant, and workspace business metrics,
- and distinguish business metrics from technical observability families.

No public route, OpenAPI, or UI rendering change is required in this increment.

### 4. Deterministic validation prevents drift

Add `scripts/lib/observability-business-metrics.mjs` and
`scripts/validate-observability-business-metrics.mjs` so future tasks cannot silently drift from the
agreed product-observability baseline.

Validation should confirm:

- all required business domains are present,
- every metric family has supported scopes and required labels,
- unsafe labels and sensitive dimensions are explicitly forbidden,
- business metric scope rules align with the existing observability scope vocabulary,
- shared docs and task summary remain discoverable,
- and `package.json` exposes `validate:observability-business-metrics` and wires it into repo
  validation.

### 5. Human-readable architecture companion

Add `docs/reference/architecture/observability-business-metrics.md` as the operator and
implementation companion for this baseline.

The document should explain:

- why business metrics belong in the same observability plane,
- the business domains covered by the contract,
- the differences between technical, health, and business metrics,
- scope/isolation and masking expectations,
- and how downstream quota, metering, summary, alerting, and smoke-test work should reuse this
  baseline.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/028-observability-business-metrics/spec.md`
- Materialize `specs/028-observability-business-metrics/plan.md`
- Materialize `specs/028-observability-business-metrics/tasks.md`

### Internal contracts and helper code

- Add `services/internal-contracts/src/observability-business-metrics.json`
- Update `services/internal-contracts/src/index.mjs`
- Extend `apps/control-plane/src/observability-admin.mjs`
- Add `scripts/lib/observability-business-metrics.mjs`
- Add `scripts/validate-observability-business-metrics.mjs`
- Update `package.json` to expose and wire the new validation command

### Documentation

- Add `docs/reference/architecture/observability-business-metrics.md`
- Update `docs/reference/architecture/README.md`
- Update `docs/tasks/us-obs-01.md` to summarize the delivered business-metrics slice and residual
  observability scope

### Tests and validation wiring

- Add `tests/unit/observability-business-metrics.test.mjs`
- Add `tests/contracts/observability-business-metrics.contract.test.mjs`

### No-change areas

- No public OpenAPI or route-catalog changes
- No console UI implementation
- No alert delivery rules
- No commercial billing logic or quota enforcement behavior
- No smoke verification or live observability checks
- No database migrations
- No Helm contract changes unless strictly required for documentation-only alignment

---

## Verification Strategy

1. Run `npm run validate:observability-business-metrics`.
2. Run targeted observability unit and contract suites for the new baseline.
3. Run markdown lint on the touched observability docs/spec set.
4. Inspect `git diff --stat` to confirm the increment stayed within observability contracts,
   helper summaries, docs, validation, and tests.
5. Leave broader integration coverage to the dedicated `test` stage and `test-runner` delegation.

---

## Risks and Mitigations

- **Risk: business metrics drift into dashboard or billing implementation**
  - Mitigation: keep the contract focused on vocabulary, scope, and usage semantics only.
- **Risk: unsafe labels leak tenant or identity detail**
  - Mitigation: validate forbidden labels and require explicit supported scopes.
- **Risk: business metrics become inconsistent with the existing observability plane**
  - Mitigation: reuse the same naming, scope, and freshness baseline and validate alignment.
- **Risk: later tasks redefine usage signals independently**
  - Mitigation: document this increment as the canonical business-metrics baseline consumed by T05,
    T06, quota, and metering-related work.

---

## Sequence

1. Materialize the Spec Kit files for task 028.
2. Add the observability business-metrics contract.
3. Wire the new contract into shared readers and control-plane summary helpers.
4. Add the validation library and dedicated validation command.
5. Add the architecture companion and update the task summary docs.
6. Add targeted unit and contract coverage.
7. Run validation, tests, and markdown lint in the dedicated test stage.
8. Commit, push, open PR, watch CI, fix deterministic regressions, and merge when green.

---

## Done Criteria

This unit is complete when:

- the Spec Kit artifacts are present,
- the observability business-metrics contract is committed and available through shared readers,
- the control-plane helper exposes business-metrics summaries and safe query metadata,
- the new architecture guide is discoverable from the architecture index,
- the task summary reflects `US-OBS-01-T04` accurately,
- `npm run validate:observability-business-metrics` passes,
- targeted unit and contract tests pass,
- touched markdown lint passes,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item.
