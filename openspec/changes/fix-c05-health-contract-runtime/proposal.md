## Why

The observability health contract is published but is not instantiated by the control-plane HTTP listener. On the current revision `/livez` and all six canonical internal health exposures return 404, while only the legacy `/healthz` and `/readyz` routes exist. This leaves Kubernetes probes and platform operators without the contractually defined, dependency-aware evidence needed to distinguish process health from service readiness.

## What Changes

- Instantiate the health contract, builders, validators, aggregation rules, and injectable component adapters in `createControlPlaneHttpServer`.
- Preserve `/healthz` and `/readyz`; add process-only `/livez` and the six canonical internal aggregate/component routes with contract-shaped JSON, correlation IDs, and deterministic unknown/stale handling.
- Keep these routes internal-only through existing topology/network and gateway absence; do not add mTLS or publish them through APISIX or the SPA.
- Map deployment probes to liveness/readiness source-of-truth, package the runtime contract in Docker, and document an operator runbook.
- Add black-box, contract, unit, and packaging regression coverage. No new metric families or labels are introduced.
