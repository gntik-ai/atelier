# Implementation Plan: US-STO-03-T06 — Storage Provider Limits, Internal SLA, and Cost Guidance

**Branch**: `024-storage-provider-guidance` | **Date**: 2026-03-28 | **Spec**: `specs/024-storage-provider-guidance/spec.md`
**Task**: US-STO-03-T06 | **Epic**: EP-12 — Storage S3-compatible
**Requirements traceability**: RF-STO-015, RF-STO-016, RF-STO-017, RF-STO-018

---

## Summary

This task is a documentation-only increment that productizes the existing storage provider
abstraction for day-two operations.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 024,
2. add one architecture reference document that explains provider posture, limits, internal SLA/SLO
   expectations, and cost/fit guidance for MinIO, Ceph RGW, and Garage,
3. update the architecture README so the new document is discoverable,
4. add a task summary document for US-STO-03,
5. validate the touched markdown files,
6. and deliver the change through the normal branch, PR, CI, and merge flow.

No storage runtime behavior, tests, or contracts need to change for this task.

---

## Technical Context

**Language / Runtime**: Markdown documentation only.
**Primary sources of truth**:

- `services/adapters/src/storage-provider-profile.mjs`
- `docs/reference/architecture/README.md`
- existing storage specs under `specs/017-*` through `specs/023-*`

**Primary artifacts in scope**:

- `specs/024-storage-provider-guidance/spec.md`
- `specs/024-storage-provider-guidance/plan.md`
- `specs/024-storage-provider-guidance/tasks.md`
- `docs/reference/architecture/storage-provider-operability.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-sto-03.md`

**Constraints**:

- Stay aligned with the current provider abstraction and capability states.
- Keep the change documentation-only.
- Avoid inventing external vendor guarantees.
- Keep the guidance operational, concise, and easy to review in PR form.

---

## Architecture / Content Strategy

### 1. Operability guide as the single human-readable source

Create `docs/reference/architecture/storage-provider-operability.md` as the operator-facing guide for
storage backend selection and day-two posture.

The guide should include:

- a provider comparison matrix,
- platform-visible planning limits,
- one internal SLA/SLO envelope for routine and degraded operation,
- provider-by-provider notes for MinIO, Ceph RGW, and Garage,
- cost/fit guidance,
- and review / escalation triggers for deployment-dependent capabilities.

### 2. Keep the guide tied to existing capability facts

Capability support statements must map directly to the existing provider capability model:

- MinIO as the primary fully satisfied profile,
- Ceph RGW as the deployment-dependent profile for some advanced capabilities,
- Garage as the constrained profile where certain advanced capabilities are not assumed.

### 3. Keep internal SLA language scoped correctly

Document internal operating targets such as:

- provider introspection freshness,
- control-plane read/write response budgets,
- usage snapshot freshness windows,
- credential rotation / revocation propagation expectations,
- degraded-mode escalation timing.

Explicitly state that these are internal operating targets, not customer-facing contractual promises.

### 4. Make the docs discoverable

Update the architecture README to reference the new storage provider guide and add a task summary doc
under `docs/tasks/` so the increment is visible in the repository's delivery history.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/024-storage-provider-guidance/spec.md`
- Materialize `specs/024-storage-provider-guidance/plan.md`
- Materialize `specs/024-storage-provider-guidance/tasks.md`

### Architecture docs

- Add `docs/reference/architecture/storage-provider-operability.md`
- Update `docs/reference/architecture/README.md`

### Task summary docs

- Add `docs/tasks/us-sto-03.md`

### No-change areas

- No OpenAPI generation
- No internal contract updates
- No service-map changes
- No runtime module changes
- No automated test fixture changes beyond markdown validation

---

## Verification Strategy

1. Run targeted markdown lint against the new and modified docs.
2. Inspect `git diff --stat` to confirm the task remained documentation-only.
3. Rely on CI for the repo's standard quality/security checks after PR creation.

---

## Risks and Mitigations

- **Risk: documentation contradicts code**
  - Mitigation: anchor provider statements to `storage-provider-profile.mjs` capability entries and
    limitations.
- **Risk: internal SLA wording is interpreted as external guarantee**
  - Mitigation: repeat the internal-only scope in the guide and the task summary.
- **Risk: markdownlint regressions**
  - Mitigation: run targeted markdown lint before commit.

---

## Sequence

1. Materialize the Spec Kit files for task 024.
2. Author the architecture guide from the existing provider capability source of truth.
3. Update the docs index and task summary.
4. Run markdown lint on touched files.
5. Commit, push, open PR, watch CI, and merge when green.

---

## Done Criteria

This unit is complete when:

- the Spec Kit artifacts are present,
- the new storage provider operability guide is committed,
- the architecture README references it,
- the task summary doc is present,
- markdown validation passes,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item.
