# US-ARC-02 Task Breakdown

## Story summary

Deliver the public-domain and deployment-topology baseline so the same logical platform surface can be deployed across `dev`, `sandbox`, `staging`, and `prod` with explicit environment governance, future topology compatibility, Helm layering rules, promotion guidance, and Kubernetes/OpenShift smoke parity.

## Backlog-to-artifact traceability

- **T01 — hostnames, route prefixes, optional subdomains, certificates**
  - `services/internal-contracts/src/deployment-topology.json`
  - `charts/in-atelier/values*.yaml`
  - `services/gateway-config/base/gateway.yaml`
  - `docs/reference/architecture/deployment-topology.md`
- **T02 — operational environment profiles**
  - `services/internal-contracts/src/deployment-topology.json`
  - `docs/reference/architecture/deployment-topology.md`
- **T03 — single-cluster baseline with future multi-cluster/multi-region compatibility**
  - `services/internal-contracts/src/deployment-topology.json`
  - `docs/adr/0004-public-domain-environment-topology.md`
  - `apps/control-plane/openapi/control-plane.openapi.json`
- **T04 — Helm/config/secret inheritance policy**
  - `charts/in-atelier/values.yaml`
  - `charts/in-atelier/values/*.yaml`
  - `scripts/lib/deployment-topology.mjs`
  - `scripts/validate-deployment-topology.mjs`
- **T05 — promotion and functional-config migration**
  - `services/internal-contracts/src/deployment-topology.json`
  - `docs/reference/architecture/deployment-topology.md`
- **T06 — Kubernetes/OpenShift smoke parity**
  - `tests/reference/deployment-smoke-matrix.yaml`
  - `tests/e2e/deployment/deployment-smoke.test.mjs`
  - `tests/contracts/deployment-topology.contract.test.mjs`

## Executable plan

1. Add a machine-readable deployment-topology contract alongside the existing internal service-map package.
2. Add Helm value overlays for four environments and both supported platforms.
3. Extend gateway base configuration with public-domain and route-prefix defaults.
4. Record the decision and operating model in a new ADR and architecture note.
5. Add validators and tests for contract integrity, layering policy, promotion flow, and Kubernetes/OpenShift smoke parity.
6. Update repository scripts, CI, and documentation.
