# US-DEP-01 Task Breakdown

## Story summary

Deliver a modular Helm deployment baseline for In Falcone with an umbrella chart, reusable component wrappers, full image/resource/persistence parametrization, explicit values layers, Helm-side validations, and an operator guide for packaging, upgrade, and rollback.

## Backlog-to-artifact traceability

- **T01 — umbrella chart with optional dependencies**
  - `charts/in-falcone/Chart.yaml`
  - `charts/in-falcone/templates/namespace.yaml`
  - `charts/in-falcone/templates/public-surface.yaml`
- **T02 — subcharts/wrappers per component**
  - `charts/in-falcone/charts/component-wrapper/Chart.yaml`
  - `charts/in-falcone/charts/component-wrapper/templates/*.yaml`
- **T03 — full deployment parametrization in values**
  - `charts/in-falcone/values.yaml`
  - `charts/in-falcone/values/*.yaml`
  - `charts/in-falcone/values.schema.json`
- **T04 — values layers for environment, customer, air-gap, and local override**
  - `charts/in-falcone/values/customer-reference.yaml`
  - `charts/in-falcone/values/airgap.yaml`
  - `charts/in-falcone/values/local.example.yaml`
  - `services/internal-contracts/src/deployment-topology.json`
- **T05 — Helm validations for incompatible/incomplete config**
  - `charts/in-falcone/templates/validate.yaml`
  - `scripts/lib/deployment-chart.mjs`
  - `scripts/validate-deployment-chart.mjs`
  - `tests/unit/deployment-chart.test.mjs`
  - `tests/contracts/deployment-chart.contract.test.mjs`
- **T06 — packaging, upgrade, rollback guide**
  - `charts/in-falcone/README.md`
  - `README.md`
  - `docs/reference/architecture/deployment-topology.md`

## Executable plan

1. Convert the base chart into an umbrella chart with aliased wrapper dependencies for every deployment component.
2. Implement a reusable wrapper subchart that can render namespaced workloads, services, config maps, and persistence primitives with OpenShift-safe defaults.
3. Expand the chart values into a full deployment contract covering images, replicas, resources, affinity, tolerations, storage, persistence, and secret references.
4. Add explicit value overlays for environment, customer, air-gap, and local workstation usage while preserving the environment/platform topology baseline.
5. Add validation helpers, a repository-level deployment-chart validator, and automated tests for dependency wiring and layer coverage.
6. Publish a concise operational guide for packaging, installation, upgrade, and rollback.
