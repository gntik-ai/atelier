## Why

Falcone depends on Knative Serving for functions and hosted MCP scale-to-zero workloads, but its
production installation still treats Knative as an externally satisfied prerequisite. Issue #932
asks whether Falcone can provide Knative Serving and Kourier without OLM or the OpenShift Serverless
Operator; the vendored upstream manifests show that this is technically feasible, but a supported
Falcone-managed lifecycle needs explicit ownership, security, supply-chain, upgrade, and failure
contracts before it can be implemented.

## What Changes

- Add three explicit runtime modes: `managed`, `external`, and `disabled`.
- Define `managed` as a separate, cluster-admin installation phase for Falcone-owned Knative Serving
  and Kourier, never as an unconditional umbrella-chart dependency.
- Define its executor as a versioned client-side lifecycle command from `falcone-charts`, operating a
  separate `falcone-knative` release without installing a long-lived Falcone operator.
- Set the initial compatibility matrix to Knative Serving/Kourier 1.22.1 on Kubernetes 1.34 and
  OpenShift 4.21 `restricted-v2`; unsupported versions fail closed until acceptance extends it.
- Require fail-closed cluster preflight, exclusive ownership markers, collision detection, staged
  readiness, digest-pinned and mirrorable images, and a provenance lock with checksums, licenses, and
  SBOMs.
- Define OpenShift `restricted-v2` compatibility by removing Kourier's fixed UID/GID while retaining
  non-root, `RuntimeDefault` seccomp, no privilege escalation, and dropped capabilities.
- Define fresh-install, existing-install migration, one-minor-at-a-time upgrade, bounded rollback,
  retain-by-default uninstall, and future Operator handoff behavior.
- Make Functions and hosted MCP fail explicitly with typed `KNATIVE_UNAVAILABLE` responses when the
  selected runtime cannot serve workloads, while preserving tenant isolation and lifecycle cleanup.
- Add persona-specific operational status, audit, observability, runbook, air-gap, and acceptance
  requirements for platform installers, operators, developers, MCP users, auditors, adjacent tenants,
  documentation-only users, and cluster administrators.
- State the support boundary: Falcone supports its patched upstream bundle on the validated matrix;
  it is not the Red Hat-supported OpenShift Serverless product path.
- Split delivery between this repository (mode and runtime contracts, errors, documentation, and
  tests) and `gntik-ai/falcone-charts` (bundle, templates, CRDs, RBAC, security, networking, images,
  and lifecycle orchestration).

This proposal is design-only. It does not install Knative, change the live runtime, or claim that
Falcone can currently deploy a managed Knative service.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment`: Add the operator-free Knative lifecycle, ownership, security, supply-chain, and
  operational-mode contract.
- `functions`: Add explicit runtime availability semantics without changing the existing tenant and
  workspace scoping of Knative Services.
- `mcp`: Add runtime availability and cleanup semantics for hosted MCP servers that depend on
  Knative scale-to-zero.

## Scope and Non-goals

In scope are Knative Serving and Kourier, their cluster-scoped prerequisites, Falcone integration,
OpenShift safety, disconnected installation, and lifecycle acceptance. Knative Eventing, OLM
packaging, the OpenShift Serverless Operator, simultaneous multi-owner reconciliation, and silently
adopting an existing installation are out of scope. This change does not redefine Function or MCP
public business semantics beyond the dependency-unavailable behavior.

## Exit Criteria

- Both repositories implement their assigned tasks and pass repository validation.
- A disposable clean-cluster acceptance run proves `managed` mode on supported Kubernetes and remote
  OpenShift with cluster-admin authority, including air-gap image rewrites and `restricted-v2`.
- Existing-install `external` mode, collision rejection, failure/degraded paths, tenant-isolation
  probes, upgrade, rollback, retain-by-default uninstall, and handoff procedures are independently
  verified.
- Documentation states support boundaries and never reports `managed` mode as available before the
  implementation and acceptance evidence exist.

## Risks and Rollback

Cluster-scoped CRDs, RBAC, admission webhooks, and shared namespaces have a high blast radius;
ownership ambiguity can cause two reconcilers to corrupt one installation. Upstream image or
manifest drift can break disconnected and security guarantees, and CRD storage migrations can make
binary rollback unsafe. Implementation therefore fails closed before mutation, records provenance,
supports only one active owner, retains CRDs and tenant workloads by default on uninstall, and limits
rollback to the last compatible bundle before any irreversible storage migration. If implementation
acceptance fails, the design artifacts remain but the feature stays unavailable and existing
`external`/`disabled` behavior remains authoritative.

## Impact

- Code evidence: `deploy/kind/knative/serving-crds.yaml`,
  `deploy/kind/knative/serving-core.yaml`, `deploy/kind/knative/kourier.yaml`,
  `apps/control-plane/function-executor.mjs::deployKnativeService`,
  `apps/control-plane/fn-handlers.mjs`, and `apps/control-plane/executor-rbac.yaml`.
- Falcone: control-plane configuration and typed errors, Functions/MCP dependency gates, audit and
  metrics contracts, tests, installation guides, and runbooks.
- `falcone-charts`: a separately orchestrated managed-Knative release, lifecycle hooks/jobs,
  provenance lock, image mirroring, security patches, and cluster-wide acceptance assets.
- External systems: Kubernetes/OpenShift admission, CRDs, RBAC, namespaces, Harbor-compatible private
  registries, and the Knative Serving/Kourier data plane.
- Follow-up implementation: [gntik-ai/falcone#933](https://github.com/gntik-ai/falcone/issues/933)
  and [gntik-ai/falcone-charts#8](https://github.com/gntik-ai/falcone-charts/issues/8), delivered
  and accepted as a coordinated release.
