# in-falcone monorepo

Bootstrap monorepo for the In Falcone platform.

## Scope of this bootstrap

This repository establishes the minimal working structure for:

- `apps/control-plane`: control plane backend surface
- `apps/web-console`: web console frontend surface
- `services/gateway-config`: gateway and runtime configuration assets, including the unified public API family routing manifest
- `services/internal-contracts`: internal service-map, authorization, deployment-topology, core-domain, and public-API taxonomy baselines
- `services/provisioning-orchestrator`: control-plane orchestration workspace
- `services/audit`: audit/evidence workspace
- `services/adapters`: external service adapter packages
- `charts/in-falcone`: umbrella Helm chart with aliased component wrappers plus layered values for Kubernetes/OpenShift deployments
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
  in-falcone/
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
- public-API taxonomy, route-catalog, family-contract, and gateway-routing validation
- deployment-topology validation for domains, environments, overlays, smoke parity, and bootstrap policy
- deployment-chart validation for umbrella dependencies, wrapper coverage, values layers, and bootstrap controller contracts
- authorization-model validation for tenant/workspace context, permission matrices, and propagation targets
- domain-model validation for canonical entities, lifecycle events, OpenAPI mapping, and seed fixtures
- markdown linting
- OpenAPI validation for the unified control-plane/public-gateway contract
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
corepack pnpm generate:public-api
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
corepack pnpm security:images
```
