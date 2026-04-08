# Implementation Plan: US-OBS-01-T01 — Unified Observability Metrics Stack Integration

**Branch**: `025-observability-metrics-stack` | **Date**: 2026-03-28 | **Spec**: `specs/025-observability-metrics-stack/spec.md`
**Task**: US-OBS-01-T01 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task is the foundational observability increment for the platform.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 025,
2. add one machine-readable internal contract that defines the seven required subsystems, the
   normalized metric families, tenant and workspace isolation labels, cardinality rules,
   collection-health meta-metrics, and collection topology,
3. mirror the same topology in the Helm values baseline for the `observability` component,
4. add one control-plane helper module that summarizes the observability plane for downstream
   tasks,
5. add one architecture reference document and one task summary document,
6. add deterministic validation and automated tests for the new baseline,
7. and deliver the change through the normal branch, PR, CI, and merge flow.

This increment does **not** implement dashboards, health endpoints, alert rules, or business
metrics. It only delivers the contract and configuration baseline that later observability tasks
must extend.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON contracts, YAML-backed Helm values, Markdown docs.
**Primary dependencies**: existing internal-contract readers, Helm values conventions, Node test
runner, markdownlint.
**Storage**: N/A — no new database schema or persistence migration.
**Testing**: `node --test` for unit and contract coverage, plus repo validation scripts.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/025-observability-metrics-stack/spec.md`
- `specs/025-observability-metrics-stack/plan.md`
- `specs/025-observability-metrics-stack/tasks.md`
- `services/internal-contracts/src/observability-metrics-stack.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `scripts/lib/observability-metrics-stack.mjs`
- `scripts/validate-observability-metrics-stack.mjs`
- `charts/in-falcone/values.yaml`
- `docs/reference/architecture/observability-metrics-stack.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-01.md`
- `tests/unit/observability-metrics-stack.test.mjs`
- `tests/contracts/observability-metrics-stack.contract.test.mjs`

**Constraints**:

- cover exactly seven subsystems: APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the
  control plane,
- keep tenant/workspace isolation explicit and safe,
- forbid unbounded or sensitive labels,
- avoid any change to public API routes or runtime behavior of the subsystems,
- keep the increment additive and reusable by `US-OBS-01-T02` through `US-OBS-01-T06`.

---

## Architecture / Content Strategy

### 1. Internal contract as the source of truth

Add `services/internal-contracts/src/observability-metrics-stack.json` as the machine-readable
source of truth for:

- normalized metric families,
- required labels,
- tenant/workspace scope semantics,
- forbidden and bounded labels,
- retention and resolution targets,
- collection-health meta-metrics,
- and per-subsystem topology descriptors.

This keeps the foundation aligned with the repo's existing contract-first patterns.

### 2. Helm baseline mirrors the contract

Extend `charts/in-falcone/values.yaml` with an `observability.config.inline.metricsStack` block so
Helm-facing deployment metadata exposes the same collection model, required labels, and component
scrape targets.

This is configuration guidance, not a claim that every runtime exporter is already deployed.

### 3. Control-plane helper stays summary-oriented

Add `apps/control-plane/src/observability-admin.mjs` with read-only helpers that summarize the
observability plane and build safe scope selectors for downstream dashboard and health tasks.

No public route or OpenAPI change is needed in this increment.

### 4. Human-readable architecture companion

Add `docs/reference/architecture/observability-metrics-stack.md` as the operator and task-author
companion for the internal contract.

The document should explain:

- normalized metric names,
- required labels,
- tenant and workspace isolation,
- cardinality controls,
- latency histogram rules,
- collection-health meta-metrics,
- internal retention and resolution targets,
- and the per-subsystem collection topology.

### 5. Deterministic validation and tests

Add a dedicated validation library and script so future tasks cannot silently drift from the agreed
baseline.

Validation should confirm:

- all required contracts exist,
- all seven subsystems are present,
- the required metric categories exist for each subsystem,
- Helm values mirror the contract version and target topology,
- and the human-readable documentation stays discoverable through the architecture index.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/025-observability-metrics-stack/spec.md`
- Materialize `specs/025-observability-metrics-stack/plan.md`
- Materialize `specs/025-observability-metrics-stack/tasks.md`

### Internal contracts and code helpers

- Add `services/internal-contracts/src/observability-metrics-stack.json`
- Update `services/internal-contracts/src/index.mjs`
- Add `apps/control-plane/src/observability-admin.mjs`
- Add `scripts/lib/observability-metrics-stack.mjs`
- Add `scripts/validate-observability-metrics-stack.mjs`

### Deployment metadata

- Update `charts/in-falcone/values.yaml` with `observability.config.inline.metricsStack`

### Documentation

- Add `docs/reference/architecture/observability-metrics-stack.md`
- Update `docs/reference/architecture/README.md`
- Add `docs/tasks/us-obs-01.md`

### Tests and validation wiring

- Add `tests/unit/observability-metrics-stack.test.mjs`
- Add `tests/contracts/observability-metrics-stack.contract.test.mjs`
- Update `package.json` scripts to include `validate:observability-metrics-stack`

### No-change areas

- No OpenAPI generation
- No public route catalog changes
- No data migration or DDL changes
- No dashboard implementation
- No health or readiness endpoint implementation
- No console UI implementation

---

## Verification Strategy

1. Run `npm run validate:observability-metrics-stack`.
2. Run targeted unit and contract suites for the observability baseline.
3. Run `npm run lint:md` on the touched markdown set.
4. Run `npm run lint` and `npm test` if the bounded delta remains green and affordable for the
   branch.
5. Inspect `git diff --stat` to confirm the increment stayed within foundational observability
   contracts, configuration, docs, and tests.

---

## Risks and Mitigations

- **Risk: contract overclaims runtime readiness**
  - Mitigation: document the baseline as configuration and contract guidance, not proof of a fully
    deployed TSDB or dashboard stack.
- **Risk: tenant isolation drift in future observability tasks**
  - Mitigation: encode the required labels and scope rules in both the machine-readable contract and
    deterministic validation.
- **Risk: cardinality explosion from subsystem-specific labels**
  - Mitigation: explicitly forbid raw paths, request ids, object keys, and similar unbounded labels.
- **Risk: storage or OpenWhisk exporter maturity differs by deployment**
  - Mitigation: keep the topology product-agnostic and allow exporter-plus-platform projections in
    the contract notes.

---

## Sequence

1. Materialize the Spec Kit files for task 025.
2. Add the internal observability metrics-stack contract and wire it into the shared readers.
3. Add the control-plane helper and Helm-facing metrics-stack config baseline.
4. Add the validation library and dedicated validation command.
5. Add the architecture companion and task summary docs.
6. Add targeted unit and contract coverage.
7. Run validation, tests, and markdown lint.
8. Commit, push, open PR, watch CI, fix deterministic regressions, and merge when green.

---

## Done Criteria

This unit is complete when:

- the Spec Kit artifacts are present,
- the observability metrics-stack contract is committed,
- Helm values mirror the same metrics-stack topology,
- the control-plane summary helper is present,
- the architecture README references the new observability guide,
- the task summary doc is present,
- targeted validation and tests pass,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item.
