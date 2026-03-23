# US-DEP-03 — hardened deployment profiles and upgrade-safe exposure options

Deliver the next deployment increment for In Atelier so operators can choose recommended deployment profiles, harden pod security defaults, target private registries and disconnected mirrors, expose services through Kubernetes `Ingress` or `LoadBalancer` and OpenShift `Route`, and validate supported in-place upgrades without forcing a reinstall.

## Backlog slices

- **T01 — hardened security contexts and SCC-compatible defaults**
  - merge global restricted pod security with component overrides
  - disable service-account token automount by default
  - add optional volume-permissions init-container support for storage classes that need explicit file-permission fixes
- **T02 — private registries and disconnected mirrors**
  - support global registry rewriting plus explicit air-gap mirror repositories
  - source image pull secrets from private-registry settings
- **T03 — external exposure and TLS strategies**
  - keep Kubernetes `Ingress` and OpenShift `Route`
  - add Kubernetes `LoadBalancer` exposure
  - support cluster-managed or external TLS modes with Helm-side validation
- **T04 — recommended deployment profiles**
  - add `all-in-one`, `standard`, and `ha` overlays under `charts/in-atelier/values/profiles/`
- **T05 — supported in-place upgrade validation**
  - add chart and repository validation for approved version transitions
  - require explicit `deployment.upgrade.currentVersion` on Helm upgrades
- **T06 — operational constraints**
  - document network-policy, proxy, and internal-certificate expectations

## Expected artifacts

- chart values, schema, and templates under `charts/in-atelier/`
- deployment validators under `scripts/`
- topology contract updates under `services/internal-contracts/src/`
- unit / contract / deployment smoke coverage under `tests/`
- operator guidance under `charts/in-atelier/README.md` and `docs/reference/architecture/deployment-topology.md`
