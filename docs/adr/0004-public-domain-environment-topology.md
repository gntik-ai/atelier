# ADR 0004: Public domain strategy, environment profiles, and deployment topology baseline

- **Status**: Accepted
- **Date**: 2026-03-23
- **Decision owners**: Architecture / platform bootstrap
- **Related task**: `US-ARC-02`

## Context

`US-ARC-01` established internal control-plane boundaries, but the repository still lacked a single source of truth for:

- the public hostname and route-prefix strategy across environments
- which operational differences are allowed between `dev`, `sandbox`, `staging`, and `prod`
- how Helm values, ConfigMaps, and secret references should layer without creating drift
- how to keep the current single-cluster deployment compatible with future multi-cluster or multi-region expansion
- how to verify Kubernetes and OpenShift expose the same logical public surface

Without that baseline, later delivery work would risk environment drift, inconsistent certificates, platform-specific public APIs, and promotion flows that silently change behavior.

## Decision

Adopt a machine-readable deployment-topology baseline in `services/internal-contracts/src/deployment-topology.json`, backed by environment/platform Helm value overlays and smoke assertions.

### 1. Public-domain strategy

Use one root domain: `in-atelier.example.com`.

Stable public surfaces:

- API: `api.<environment>.in-atelier.example.com` (production: `api.in-atelier.example.com`)
- Console: `console.<environment>.in-atelier.example.com` (production: `console.in-atelier.example.com`)
- Identity: `iam.<environment>.in-atelier.example.com` (production: `iam.in-atelier.example.com`)
- Realtime: `realtime.<environment>.in-atelier.example.com` (production: `realtime.in-atelier.example.com`)

Stable route prefixes:

- `/control-plane`
- `/auth`
- `/realtime`
- `/`

Optional workspace/application subdomains are allowed only in `dev` and `sandbox`.

### 2. Environment profiles

Allow environments to differ only in explicitly governed operational settings:

- log level
- debug-header exposure
- passthrough mode
- demo-data availability
- quota profile
- hostname and certificate bindings
- approved secret references

Do **not** allow environments to change the public route prefixes or core service ports.

### 3. Topology compatibility

Model the current state as single-cluster and single-region per environment, but require any later multi-cluster or multi-region evolution to preserve:

- public hostnames
- public route prefixes
- the pinned `X-API-Version` expectations
- explicit placement metadata (`environment_id`, `cluster_ref`, `region_ref`)

### 4. Configuration layering

Standardize Helm/runtime layering as:

1. common chart values
2. environment overlay
3. customer overlay
4. platform overlay
5. air-gap/private-registry overlay
6. local workstation override
7. runtime secret references

Repository-tracked artifacts may store only secret references, never raw credentials or TLS material.

### 5. Platform parity

Require Kubernetes and OpenShift to expose the same logical surface, differing only in the final routing resource:

- Kubernetes: `Ingress`
- OpenShift: `Route`

## Consequences

### Positive

- Creates one auditable source of truth for hostname, certificate, environment, and topology policy.
- Reduces drift between non-production and production setups.
- Makes promotion/config migration explicit before CD automation exists.
- Keeps future topology expansion compatible with the current public API contract.
- Adds executable validation and smoke coverage for Kubernetes/OpenShift parity.

### Trade-offs

- Adds several repository artifacts to keep aligned (contract JSON, values overlays, smoke matrix, docs).
- Documents deployment intent before runtime templates or controllers are fully implemented.
- Keeps some operational automation deferred to later stories.

## Deferred work

This ADR does not introduce:

- live cluster provisioning
- Helm template rendering in CI using a Helm binary
- traffic-shifting controllers or DNS automation
- mutating deployment-management APIs
- secret-management integrations beyond reference conventions

Those concerns must extend this baseline rather than bypass it.
