# Implementation Plan: US-OBS-01-T03 — Component Health, Readiness, and Liveness Checks

**Branch**: `027-observability-health-checks` | **Date**: 2026-03-28 | **Spec**: `specs/027-observability-health-checks/spec.md`
**Task**: US-OBS-01-T03 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task is the third observability increment for the platform.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 027,
2. add one machine-readable internal contract that defines canonical `liveness`, `readiness`, and
   `health` semantics for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control
   plane,
3. add the internal operational exposure model for aggregate platform probes and per-component
   probe inspection,
4. extend the observability metrics-stack contract additively with normalized probe metric families
   so health outcomes are queryable through the common observability plane,
5. extend shared readers and the control-plane observability helper so downstream work can consume
   health-check metadata without reading raw files directly,
6. add deterministic validation, architecture documentation, and story-summary updates,
7. add targeted unit and contract coverage for the new health baseline,
8. and deliver the change through the normal branch, PR, CI, and merge flow.

This increment does **not** implement public APIs, console UI, alert routing, or live smoke
verification. It defines and materializes the canonical internal health baseline that downstream
observability work must consume.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON internal contracts, Markdown docs.
**Primary dependencies**: existing observability metrics-stack and dashboards baselines, shared
internal-contract readers, Node test runner, markdownlint.
**Storage**: N/A — no database schema or persistence migration.
**Testing**: `node --test` unit and contract coverage plus dedicated repo validation scripts.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/027-observability-health-checks/spec.md`
- `specs/027-observability-health-checks/plan.md`
- `specs/027-observability-health-checks/tasks.md`
- `services/internal-contracts/src/observability-health-checks.json`
- `services/internal-contracts/src/observability-metrics-stack.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `scripts/lib/observability-health-checks.mjs`
- `scripts/validate-observability-health-checks.mjs`
- `docs/reference/architecture/observability-health-checks.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-01.md`
- `tests/unit/observability-health-checks.test.mjs`
- `tests/contracts/observability-health-checks.contract.test.mjs`
- `package.json`

**Constraints**:

- preserve `US-OBS-01-T01` as the authoritative subsystem catalog and observability-plane baseline,
- remain compatible with the dashboard semantics introduced by `US-OBS-01-T02`,
- keep the exposure internal/operational rather than introducing a new public API commitment,
- explicitly distinguish `liveness`, `readiness`, and broader `health` semantics,
- prefer normalized masked dependency summaries over vendor-specific raw endpoint contracts,
- keep the increment additive and reusable by `US-OBS-01-T04` through `US-OBS-01-T06`.

---

## Architecture / Content Strategy

### 1. Dedicated health-check contract as the operational source of truth

Add `services/internal-contracts/src/observability-health-checks.json` as the machine-readable
source of truth for:

- probe types (`liveness`, `readiness`, `health`) and their canonical meaning,
- the allowed health/probe state model,
- aggregate platform exposures and per-component operational exposures,
- response-shape expectations for component probe results and platform rollups,
- masking/redaction rules for sensitive dependency detail,
- audit and correlation context requirements,
- component-specific probe metadata for APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage,
  and the control plane,
- and the projection of probe outcomes into the observability plane.

This keeps the health baseline explicit and contract-first without pretending that a full runtime
probe implementation already exists everywhere in-repo.

### 2. Additive metrics-stack extension for normalized probe families

Update `services/internal-contracts/src/observability-metrics-stack.json` additively so the common
observability plane explicitly knows about normalized probe-related metric families, such as:

- probe status,
- probe duration,
- and probe failure counters.

That allows future dashboards, alerts, and smoke checks to consume health outcomes through the same
normalized metrics vocabulary instead of inventing a parallel naming scheme.

### 3. Shared readers and control-plane helpers stay read-only and summary-oriented

Update `services/internal-contracts/src/index.mjs` so downstream code can read the health-check
contract, list supported probe types, and inspect component health metadata.

Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers that:

- summarize the health-check baseline,
- expose the internal operational exposure templates,
- build safe component probe summaries,
- and describe how probe outcomes align with dashboard scope semantics.

No public route, OpenAPI, or UI rendering change is required in this increment.

### 4. Deterministic validation prevents semantic drift

Add `scripts/lib/observability-health-checks.mjs` and
`scripts/validate-observability-health-checks.mjs` so future tasks cannot silently drift from the
agreed baseline.

Validation should confirm:

- all three canonical probe types exist,
- all seven required components are covered,
- component ids align with the metrics-stack subsystem catalog,
- probe metric projections reference normalized metric families known to the metrics-stack contract,
- internal exposure templates remain marked as platform/internal surfaces,
- masking, audit, and stale/unknown semantics are explicit,
- the docs index and story summary remain discoverable,
- and `package.json` exposes `validate:observability-health-checks` and wires it into repo
  validation.

### 5. Human-readable architecture companion

Add `docs/reference/architecture/observability-health-checks.md` as the operator and implementation
companion for the health baseline.

The document should explain:

- what `liveness`, `readiness`, and `health` mean in this platform,
- why these semantics are intentionally different,
- the aggregate vs per-component operational exposure model,
- masking/redaction expectations,
- the relationship to the observability plane and dashboard semantics,
- and how later alerting, console, and smoke-test work should reuse this baseline.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/027-observability-health-checks/spec.md`
- Materialize `specs/027-observability-health-checks/plan.md`
- Materialize `specs/027-observability-health-checks/tasks.md`

### Internal contracts and helper code

- Add `services/internal-contracts/src/observability-health-checks.json`
- Update `services/internal-contracts/src/observability-metrics-stack.json` additively with probe
  metric families
- Update `services/internal-contracts/src/index.mjs`
- Extend `apps/control-plane/src/observability-admin.mjs`
- Add `scripts/lib/observability-health-checks.mjs`
- Add `scripts/validate-observability-health-checks.mjs`
- Update `package.json` to expose and wire the new validation command

### Documentation

- Add `docs/reference/architecture/observability-health-checks.md`
- Update `docs/reference/architecture/README.md`
- Update `docs/tasks/us-obs-01.md` to summarize the delivered health-check slice and residual
  observability scope

### Tests and validation wiring

- Add `tests/unit/observability-health-checks.test.mjs`
- Add `tests/contracts/observability-health-checks.contract.test.mjs`

### No-change areas

- No public OpenAPI or route-catalog changes
- No console UI implementation
- No alert delivery or incident-routing rules
- No live smoke verification or runtime probe execution
- No database migrations
- No Helm manifest authoring beyond documentation of the operational contract

---

## Verification Strategy

1. Run `npm run validate:observability-health-checks`.
2. Run targeted observability unit and contract suites for the new baseline.
3. Run markdown lint on the touched observability docs/spec set.
4. Inspect `git diff --stat` to confirm the increment stayed within observability contracts,
   helper summaries, docs, validation, and tests.
5. Leave broader end-to-end coverage to the dedicated `test` stage and `test-runner` delegation.

---

## Risks and Mitigations

- **Risk: readiness and liveness semantics collapse into the same thing**
  - Mitigation: encode separate definitions and validate that every component supports all three
    probe classes.
- **Risk: contract overclaims public or live runtime endpoints**
  - Mitigation: keep exposure templates explicitly internal/platform-only and avoid OpenAPI changes.
- **Risk: sensitive dependency failures leak internals**
  - Mitigation: treat masking, normalized error classes, and audit fields as first-class contract
    elements.
- **Risk: health signals drift away from dashboard semantics**
  - Mitigation: validate alignment with both the metrics-stack and dashboard baselines.
- **Risk: future observability tasks redefine health independently**
  - Mitigation: document this task as the canonical health baseline consumed by T04–T06.

---

## Sequence

1. Materialize the Spec Kit files for task 027.
2. Add the observability health-check contract.
3. Extend the observability metrics-stack contract additively with normalized probe metric
   families.
4. Wire the new contract into shared readers and control-plane summary helpers.
5. Add the validation library and dedicated validation command.
6. Add the architecture companion and update the task summary docs.
7. Add targeted unit and contract coverage.
8. Run validation, tests, and markdown lint in the dedicated test stage.
9. Commit, push, open PR, watch CI, fix deterministic regressions, and merge when green.

---

## Done Criteria

This unit is complete when:

- the Spec Kit artifacts are present,
- the observability health-check contract is committed and available through shared readers,
- the observability metrics-stack contract includes additive normalized probe metric families,
- the control-plane helper exposes health-check summaries and component metadata,
- the new architecture guide is discoverable from the architecture index,
- the task summary reflects `US-OBS-01-T03` accurately,
- `npm run validate:observability-health-checks` passes,
- targeted unit and contract tests pass,
- touched markdown lint passes,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item.
