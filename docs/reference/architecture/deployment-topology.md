# Public Domain, Environment Profiles, and Deployment Topology Baseline

This note is the human-readable companion to `services/internal-contracts/src/deployment-topology.json`.

## Scope

`US-ARC-02` establishes one public-domain strategy that can be deployed consistently across `dev`, `sandbox`, `staging`, and `prod`, while keeping the same logical API surface when the platform later evolves from single-cluster to multi-cluster or multi-region.

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

## Certificate naming

- Issuer reference: `ClusterIssuer/letsencrypt-public`
- Wildcard secret pattern: `in-atelier-<environment>-wildcard-tls`
- Surface secret pattern: `in-atelier-<environment>-<surface>-tls`

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
- same Helm chart layered as `base -> environment -> platform -> secretRefs`

### Forward-compatibility guardrails

Future multi-cluster or multi-region work must preserve:

- public hostnames per environment
- route prefixes
- `X-API-Version` contract expectations
- placement metadata (`environment_id`, `cluster_ref`, `region_ref`)
- deterministic promotion/failover identifiers for future mutating deployment APIs

## Promotion strategy

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

## Platform parity

- Kubernetes exposes the public surface via `Ingress`.
- OpenShift exposes the same logical surface via `Route`.
- Both platforms must keep the same base resource set (`Namespace`, `ConfigMap`, `Deployment`, `Service`) and differ only on the final exposure resource kind.

The smoke matrix under `tests/reference/deployment-smoke-matrix.yaml` is the executable parity checklist.
