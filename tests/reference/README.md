# Testing Strategy Reference Assets

This directory contains the reusable testing-strategy package for `US-PRG-04-T01`.

## Contents

- `testing-strategy.yaml` — the testing pyramid, cross-domain matrix, taxonomy, console-state expectations, and API-versioning expectations
- `reference-dataset.json` — synthetic fixtures shared across multi-tenant, security, data, event, console, and resilience scenarios
- `domain-seed-fixtures.json` — canonical tenant/workspace/entity seed profiles for starter, growth, and enterprise demos/tests
- `deployment-smoke-matrix.yaml` — environment/platform smoke assertions for Kubernetes/OpenShift public-surface parity

## Usage rules

- Reuse existing fixture IDs whenever possible instead of inventing near-duplicates.
- Add new matrix scenarios before adding framework-specific test implementations.
- Keep the assets synthetic and non-secret.
- Preserve alignment with `apps/control-plane/openapi/control-plane.openapi.json` when contract expectations change.
- Keep domain seed profiles aligned with `services/internal-contracts/src/domain-model.json` and the control-plane OpenAPI contract.
- Keep deployment smoke assertions aligned with `services/internal-contracts/src/deployment-topology.json` and Helm value overlays.
