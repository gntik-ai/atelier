# in-atelier monorepo

Bootstrap monorepo for the In Atelier platform.

## Scope of this bootstrap

This repository establishes the minimal working structure for:

- `apps/control-plane`: control plane backend surface
- `apps/web-console`: web console frontend surface
- `services/gateway-config`: gateway and runtime configuration assets
- `services/internal-contracts`: internal service-map, authorization, deployment-topology, and core-domain contract baselines
- `services/provisioning-orchestrator`: control-plane orchestration workspace
- `services/audit`: audit/evidence workspace
- `services/adapters`: external service adapter packages
- `charts/in-atelier`: umbrella Helm chart with aliased component wrappers plus layered values for Kubernetes/OpenShift deployments
- `docs`: architecture and working conventions
- `tests/e2e`: end-to-end test workspace
- `tests/reference`: reusable testing strategy package and synthetic reference dataset
- `.specify`: Spec Kit context and project conventions

## Monorepo layout

```text
apps/
  control-plane/
  web-console/
services/
  gateway-config/
  internal-contracts/
  provisioning-orchestrator/
  audit/
  adapters/
charts/
  in-atelier/
docs/
tests/
  adapters/
  contracts/
  e2e/
  reference/
  resilience/
  unit/
```

## Working conventions

- Use `pnpm` workspaces from the repository root.
- Keep deployable applications under `apps/`.
- Keep reusable service-side packages and operational assets under `services/`.
- Keep documentation under `docs/` and decisions under `docs/adr/`.
- Keep environment-specific deployment values outside chart templates when possible.
- Layer deployment values as `common -> environment -> customer -> platform -> airgap -> localOverride -> secretRefs` to make promotion and rollback auditable.
- Keep OpenShift compatibility by avoiding privileged defaults and using standard Kubernetes APIs.

## Quality gates

The current baseline quality chain covers:

- repository structure validation
- PostgreSQL ADR package validation
- testing-strategy package validation
- internal service-map validation
- deployment-topology validation for domains, environments, overlays, and smoke parity
- deployment-chart validation for umbrella dependencies, wrapper coverage, and values layers
- authorization-model validation for tenant/workspace context, permission matrices, and propagation targets
- domain-model validation for canonical entities, lifecycle events, OpenAPI mapping, and seed fixtures
- markdown linting
- OpenAPI validation for the control-plane contract
- unit tests for helper logic and strategy consistency
- adapter-integration scaffold tests
- contract tests for API versioning/error expectations
- internal contract/service-map tests
- console E2E scaffold tests
- deployment smoke scaffold tests for Kubernetes/OpenShift parity
- resilience scaffold tests
- dependency vulnerability audit
- immutable image-reference policy checks

Run:

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
corepack pnpm security:images
```
