# Testing Strategy Reference Assets

This directory contains the reusable testing-strategy package for `US-PRG-04-T01`.

## Contents

- `testing-strategy.yaml` — the testing pyramid, cross-domain matrix, taxonomy, console-state expectations, and API-versioning expectations
- `reference-dataset.json` — synthetic fixtures shared across multi-tenant, security, data, event, console, and resilience scenarios
- `domain-seed-fixtures.json` — canonical tenant/workspace/entity seed profiles for starter, growth, and enterprise demos/tests, including memberships, invitations, and plan-governance references
- `deployment-smoke-matrix.yaml` — environment/platform smoke assertions for Kubernetes/OpenShift public-surface parity
- `observability-smoke-matrix.yaml` — observability scraping, dashboard, and health smoke assertions aligned with the T01–T05 contracts
- `audit-traceability-matrix.yaml` — end-to-end audit traceability, masking, isolation, permission-boundary, and trace-state verification scenarios aligned with `US-OBS-02-T06`

## Usage rules

- Reuse existing fixture IDs whenever possible instead of inventing near-duplicates.
- Add new matrix scenarios before adding framework-specific test implementations.
- Keep the assets synthetic and non-secret.
- Preserve alignment with `apps/control-plane/openapi/control-plane.openapi.json` when contract expectations change.
- Keep domain seed profiles aligned with `services/internal-contracts/src/domain-model.json` and the control-plane OpenAPI contract.
- Keep deployment smoke assertions aligned with `services/internal-contracts/src/deployment-topology.json` and Helm value overlays.
- Keep observability smoke assertions aligned with `services/internal-contracts/src/observability-metrics-stack.json`, `services/internal-contracts/src/observability-dashboards.json`, `services/internal-contracts/src/observability-health-checks.json`, `services/internal-contracts/src/observability-business-metrics.json`, and `services/internal-contracts/src/observability-console-alerts.json`.
- Keep audit traceability assertions aligned with `services/internal-contracts/src/observability-audit-pipeline.json`, `services/internal-contracts/src/observability-audit-event-schema.json`, `services/internal-contracts/src/observability-audit-query-surface.json`, `services/internal-contracts/src/observability-audit-export-surface.json`, and `services/internal-contracts/src/observability-audit-correlation-surface.json`.
