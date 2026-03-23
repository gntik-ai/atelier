# Public Domain, Environment Profiles, and Deployment Topology Baseline

This note is the human-readable companion to `services/internal-contracts/src/deployment-topology.json`.

## Scope

`US-ARC-02` established one public-domain strategy that can be deployed consistently across `dev`, `sandbox`, `staging`, and `prod`, while keeping the same logical API surface when the platform later evolves from single-cluster to multi-cluster or multi-region.

`US-DEP-03` extends that baseline with deployment-profile overlays, additional Kubernetes exposure options, upgrade guardrails, and operational constraints for security-hardened clusters.

## Public-domain strategy

- Root domain: `in-atelier.example.com`
- Stable public surfaces:
  - API: `api.<environment>.in-atelier.example.com` except production, which uses `api.in-atelier.example.com`
  - Console: `console.<environment>.in-atelier.example.com` except production, which uses `console.in-atelier.example.com`
  - Identity: `iam.<environment>.in-atelier.example.com` except production, which uses `iam.in-atelier.example.com`
  - Realtime: `realtime.<environment>.in-atelier.example.com` except production, which uses `realtime.in-atelier.example.com`
- Stable route prefixes:
  - control plane: `/control-plane`
  - identity: `/auth`
  - realtime: `/realtime`
  - console: `/`
- Optional workspace/application subdomains are allowed only for `dev` and `sandbox`, using `{workspaceSlug}.apps.{environment}.in-atelier.example.com`.

## Certificate naming and TLS modes

- Issuer reference: `ClusterIssuer/letsencrypt-public`
- Wildcard secret pattern: `in-atelier-<environment>-wildcard-tls`
- Surface secret pattern: `in-atelier-<environment>-<surface>-tls`
- Supported TLS modes:
  - `clusterManaged`: the charted exposure resource binds existing cluster-provided TLS assets
  - `external`: an external load balancer or edge tier terminates TLS before traffic reaches the in-cluster Service

The repository stores only secret references, never TLS material.

## Environment profile policy

| Environment | Logs | Debug headers | Passthrough | Demo data | Limits |
|-------------|------|---------------|-------------|-----------|--------|
| `dev` | `debug` | yes | enabled | yes | relaxed |
| `sandbox` | `info` | no | limited | yes | preview |
| `staging` | `info` | no | disabled | no | production_like |
| `prod` | `warn` | no | disabled | no | strict |

Only the above operational characteristics, hostname/certificate bindings, and approved secret references may vary by environment. Public route prefixes and service ports stay invariant.

## Topology baseline and evolution

### Current baseline

- one cluster per environment
- one region per environment (`eu-west-1` in the baseline metadata)
- same logical public API surface across environments
- one umbrella Helm chart with aliased reusable component wrappers for APISIX, Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, storage, observability, control-plane, and web-console
- same required Helm layer contract as `common -> environment -> customer -> platform -> airgap -> localOverride -> secretRefs`
- one optional deployment-profile overlay inserted immediately after `common` when operators choose `all-in-one`, `standard`, or `ha`

### Deployment profile policy

- `all-in-one`: reduced replica counts and storage footprints for compact clusters and demos
- `standard`: repository default for balanced shared deployments
- `ha`: higher replica counts and anti-affinity for stateless entry points; true end-to-end HA still expects separately hardened or externally managed stateful dependencies

The recommended profile overlays live under `charts/in-atelier/values/profiles/` and are referenced by the same deployment contract across environments.

### Forward-compatibility guardrails

Future multi-cluster or multi-region work must preserve:

- public hostnames per environment
- route prefixes
- `X-API-Version` contract expectations
- placement metadata (`environment_id`, `cluster_ref`, `region_ref`)
- deterministic promotion/failover identifiers for future mutating deployment APIs

## Promotion and upgrade strategy

Canonical promotion path:

1. `dev`
2. `staging`
3. `prod`

`sandbox` is refreshed from `prod` for preview/demo purposes instead of acting as a promotion source.

Each promotion must review functional config drift for:

- gateway hosts
- feature flags
- quota profile
- demo-data policy
- TLS secret references

### In-place upgrade guardrails

- supported by default for `0.2.0 -> 0.3.0` style version changes
- operators must supply `deployment.upgrade.currentVersion` during Helm upgrades
- downgrade attempts remain blocked unless explicitly overridden
- upgrades reuse the same values layering model rather than requiring a full reinstall

## Platform parity and exposure matrix

Baseline parity remains:

- Kubernetes exposes the public surface via `Ingress`.
- OpenShift exposes the same logical surface via `Route`.
- Both platforms keep the same base resource set (`Namespace`, `ConfigMap`, `Deployment`, `Service`) and differ only on the final exposure resource kind.
- Public endpoint bindings may target disabled wrapper components only when the chart values point to an explicit externally managed service name.

Additional supported exposure options:

- Kubernetes may use `LoadBalancer` instead of `Ingress`.
- `LoadBalancer` requires `publicSurface.tls.mode=external` because TLS terminates outside the chart-managed resource set.
- OpenShift keeps `Route` as the supported exposure resource with configurable route termination settings.

The smoke matrix under `tests/reference/deployment-smoke-matrix.yaml` remains the executable parity checklist for the baseline Kubernetes/OpenShift path. LoadBalancer is an operator-selected extension, not the baseline parity target.

## Security posture and operational constraints

### Pod security / SCC alignment

- steady-state containers default to non-root execution and disabled service-account token automount
- pod-level security context merges global restricted defaults with component-specific storage overrides
- optional volume-permissions init containers exist for storage classes that ignore group ownership updates, but remain disabled by default to preserve OpenShift `restricted-v2` compatibility

### Network policies

Clusters with default-deny policies must preserve:

- ingress from the chosen exposure controller to public Services
- namespace-local east-west traffic among APISIX, control-plane, console, identity, and stateful dependencies
- DNS plus required egress to observability, storage, and identity systems

### Corporate proxies and internal certificates

- proxy variables are injected through component-level environment overlays
- cluster-local domains, Pod CIDRs, and service suffixes must stay in `NO_PROXY`
- internal CA bundles are mounted via ConfigMaps/Secrets or image trust stores, never stored in git-tracked values files

The operator packaging guide lives in `charts/in-atelier/README.md` and is part of the deployment baseline.
