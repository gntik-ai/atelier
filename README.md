# in-atelier monorepo

Bootstrap monorepo for the In Atelier platform.

## Scope of this bootstrap

This repository establishes the minimal working structure for:

- `apps/control-plane`: control plane backend surface
- `apps/web-console`: web console frontend surface
- `services/gateway-config`: gateway and runtime configuration assets
- `services/adapters`: external service adapter packages
- `charts/in-atelier`: Helm chart skeleton for Kubernetes/OpenShift deployments
- `docs`: architecture and working conventions
- `tests/e2e`: end-to-end test workspace
- `.specify`: Spec Kit context and project conventions

## Monorepo layout

```text
apps/
  control-plane/
  web-console/
services/
  gateway-config/
  adapters/
charts/
  in-atelier/
docs/
tests/
  e2e/
```

## Working conventions

- Use `pnpm` workspaces from the repository root.
- Keep deployable applications under `apps/`.
- Keep reusable service-side packages and operational assets under `services/`.
- Keep documentation under `docs/` and decisions under `docs/adr/`.
- Keep environment-specific deployment values outside chart templates when possible.
- Keep OpenShift compatibility by avoiding privileged defaults and using standard Kubernetes APIs.

## Quality gates

Current bootstrap quality gates are intentionally lightweight:

- repository structure validation
- workspace script presence
- chart file presence

Run:

```bash
pnpm validate:structure
pnpm lint
pnpm test
```
