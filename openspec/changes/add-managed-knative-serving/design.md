## Context

Falcone currently treats Knative Serving as an external production prerequisite while its kind
profile installs Knative Serving and Kourier directly from vendored upstream YAML. Functions and
hosted MCP servers both depend on Knative Service (`ksvc`) behavior: revisioned rollouts,
scale-to-zero, internal routing, readiness, rollback, and owner-scoped teardown. Issue #932 asks
whether the existing operator-free precedent can become a supported Falcone installation mode.

The answer is conditionally yes. Upstream YAML does not require OLM or an Operator, but the
installation is cluster-scoped and shared: it owns CRDs, cluster RBAC, admission webhooks, system
namespaces, controllers, and an ingress data plane. It therefore cannot be installed with ordinary
tenant or namespace-editor credentials and cannot safely coexist with another reconciler.

The designated remote OpenShift environment is useful for compatibility and authorization evidence,
but not for a clean installation. It already advertises `serving.knative.dev` and
`operator.knative.dev`; the available identity can create project-scoped Knative Services but cannot
create CRDs, ClusterRoles, namespaces, or admission webhook configurations. Replacing or duplicating
the existing control plane would violate the ownership gate. Implementation acceptance consequently
requires a disposable clean OpenShift environment with cluster-admin authority.

This change is a design contract only. It does not make managed Knative available.

### Personas and authority boundary

- P18 platform installer selects a mode, supplies mirror/provenance inputs, and runs preflight.
- P3 platform operator observes readiness and performs supported lifecycle operations.
- A cluster administrator grants the cluster-scoped authority required by `managed`; this is a
  deployment boundary, not an application persona or a tenant role.
- P8 function developers retain deploy, invoke, version, rollback, and delete semantics.
- P7 MCP owners and P12 MCP consumers retain hosted-server lifecycle and invocation semantics.
- P10 read-only auditors can observe mode, version, owner, readiness, and audit evidence without a
  mutation path.
- P13 adjacent tenants cannot discover another tenant's workloads or dependency state.
- P17 documentation-only users receive truthful support and availability boundaries.

## Goals / Non-Goals

**Goals:**

- Productize a reproducible, operator-free Knative Serving and Kourier installation design.
- Keep Knative ownership and lifecycle explicit through `managed`, `external`, and `disabled` modes.
- Work on OpenShift `restricted-v2` without a privileged or custom SCC.
- Support disconnected Harbor-based installation with immutable image references.
- Preserve current Function and hosted MCP semantics and tenant boundaries.
- Define clean-install, existing-install, upgrade, rollback, uninstall, and future handoff behavior.
- Split implementation ownership cleanly between Falcone runtime code and `falcone-charts`.

**Non-Goals:**

- Implement the installer, runtime gates, UI, or chart in issue #932.
- Package OLM, install the OpenShift Serverless Operator, or claim Red Hat product support for raw
  upstream manifests.
- Introduce a Knative-free execution backend, KEDA, or another FaaS implementation.
- Install Knative Eventing or change APISIX architecture.
- Silently adopt an existing Knative installation or support simultaneous reconcilers.

## Decisions

### D1: Choose the bundled serving layer, with three explicit modes

The selected option is the issue's Option A: Falcone may ship Knative Serving and Kourier as a
versioned, operator-free bundle. It is exposed through exactly three installation modes:

- `managed`: Falcone owns and reconciles one known bundle.
- `external`: Falcone validates compatibility/readiness and never mutates the external installation.
- `disabled`: non-Knative capabilities install, while Functions/hosted MCP report explicit disabled
  or dependency-unavailable states.

`managed` is the clean-install target, not an implicit migration default. An existing installation
must choose `external`, `disabled`, or a reviewed migration. This preserves ADR-12's reuse-Knative
decision; no Knative-free driver is introduced.

Alternatives rejected:

- A namespace-only Kubernetes driver would require reimplementing revision routing, scale-to-zero,
  concurrency autoscaling, cold starts, rollback, MCP isolation, and teardown. It is much larger than
  productizing the proven Knative seam and would change load-bearing semantics.
- Leaving only today's implicit degraded behavior does not satisfy clean-install usability. It is
  retained as the explicit `disabled` mode and as honest unavailable behavior, not as the chosen end
  state.

### D2: Use a client-side lifecycle command and a separate, ordered release

The Falcone application release must not take an unconditional dependency on cluster-scoped Knative
resources. `falcone-charts` will publish a versioned client-side managed-Knative lifecycle command
and bundle. A cluster administrator invokes that command to operate a separate `falcone-knative`
release; it is not a long-lived in-cluster Falcone Operator or controller. The command owns staged
CRD lifecycle and records a release identity plus provenance in `knative-serving`; the Helm release
owns the rendered non-CRD bundle resources. This is the only managed executor/ownership model.

The lifecycle command orchestrates these phases:

1. Fail-closed compatibility, authority, provenance, and ownership preflight.
2. Apply CRDs and wait for every required CRD to become `Established`.
3. Create system namespaces, service accounts, RBAC, configuration, and Services.
4. Start the Knative webhook Deployment without AdmissionRegistration objects; wait for its Service
   endpoint and generated serving certificate.
5. Apply the three AdmissionRegistration configurations, wait for non-empty CA bundles, and prove an
   admission request before any dependent controller or Knative custom-resource write.
6. Apply the remaining Knative Serving controllers and wait for control-plane readiness.
7. Apply Kourier controllers/gateway and wait for data-plane readiness.
8. Create, invoke, and delete an isolated smoke `ksvc` before publishing ready state.
9. Enable downstream Function and MCP readiness.

This ordering is explicit because Helm places CRDs from `crds/` before templates but intentionally
does not upgrade, roll back, or delete them. CRD migration and retention need lifecycle code rather
than ordinary Helm rollback semantics.

### D3: Exclusive ownership; external mode is observational

Managed resources carry a stable Falcone ownership identity and bundle provenance. Preflight
enumerates all cluster-scoped and namespaced resources in the bundle before any mutation. It fails if
resources are controlled by OLM, OpenShift Serverless, another raw installer, a different Falcone
installation, or an unknown owner. Partial or ambiguous ownership is an error, not an adoption path.

External mode performs discovery and version compatibility plus read/invoke checks against an
administrator-supplied, pre-existing canary `ksvc`. Validation never creates or deletes a canary,
installs, patches, upgrades, relabels, or claims ownership. If the canary reference is absent, cannot
be read/invoked, or returns an incompatible result, external readiness is `unverified` and dependent
workload gates remain closed.

A transition to or from an Operator is a runbook-driven cutover state machine: preflight and back up;
quiesce tenant writes; stop the old reconciler while retaining CRDs/workloads; release its ownership;
enable exactly one new reconciler; then prove control/data-plane readiness before resuming. A failure
before the new owner mutates resources may restore the old owner. A failure after new-owner mutation
remains quiesced for forward repair or restore; it never restarts the old reconciler concurrently.

### D4: Lock upstream manifests and every image

The current kind assets demonstrate the shape but are not yet a production supply-chain bundle:

- `serving-crds.yaml` contains 12 Serving CRDs.
- `serving-core.yaml` contains the `knative-serving` namespace, cluster RBAC, four controller
  workloads, services/configuration, and three admission webhook configurations.
- `kourier.yaml` contains `kourier-system`, cluster RBAC, the controller and gateway.
- Knative Serving and Kourier controller images are digest-pinned, but Envoy currently uses the
  mutable `docker.io/envoyproxy/envoy:v1.37-latest` reference.

The initial supported matrix is Knative Serving/Kourier 1.22.1 on Kubernetes 1.34 and OpenShift 4.21
under `restricted-v2`. Other Kubernetes, OpenShift, Knative, or Kourier versions fail closed until
independent acceptance extends the matrix. Falcone supports the patched upstream bundle only on this
published matrix; it does not represent the Red Hat-supported OpenShift Serverless product path.

Each Falcone bundle records the upstream release and source revision, original and patched
manifest checksums, licenses, SBOMs, and the complete image digest list. Bundle validation rejects
tags. The chart repository rewrites every image to the configured Harbor registry without changing
the digest and verifies that disconnected rendering has no public registry reference.

### D5: Patch Kourier for OpenShift's arbitrary UID model

The upstream Kourier gateway fixes `runAsUser: 65534` and `runAsGroup: 65534`. OpenShift
`restricted-v2` assigns a namespace-specific arbitrary UID range, so the fixed identity can be denied.
The OpenShift variant removes both fixed fields. It does not read a namespace annotation and render a
different fixed UID. The platform remains responsible for selecting the UID/GID at admission.

The patch retains `runAsNonRoot: true`, `allowPrivilegeEscalation: false`,
`seccompProfile.type: RuntimeDefault`, and `capabilities.drop: [ALL]`. No custom SCC, privileged
service account, or UID-range exemption is part of the design. Disposable acceptance validates all
workloads under `restricted-v2`, including a server-side admission check and real pod startup.

### D6: Make availability a first-class runtime contract

Falcone exposes runtime mode, owner, compatible version, readiness stage, reason, and transition time
to authorized operators/read-only auditors. Function and MCP create/update/invoke mutations requiring
Knative are gated before partial work. A configured but unavailable runtime yields HTTP `503` and the
stable code `KNATIVE_UNAVAILABLE`, a bounded reason, and a correlation ID. An intentionally disabled
Functions capability retains `501 FUNCTIONS_DISABLED`; MCP's existing disabled/unregistered behavior
remains distinguishable.

Metadata reads that do not require the runtime remain available and honest. They may expose the
caller's dependency state but never mark an unverified workload ready. An ordinary Function or hosted
MCP delete during an outage atomically moves the logical resource to `deletion_pending`, records a
durable cleanup obligation, and returns HTTP `202`; repeats return the same pending outcome. Tenant
teardown and capability disable use the same obligation and keep their aggregate operation pending.
No path reports completion until all owned runtime resources are gone. Recovery retries are
idempotent.

### D7: Upgrade one Knative minor at a time; retain data by default

The client-side lifecycle command compares the current provenance record with the target bundle and rejects
skipped-minor upgrades. Before mutation it records resources, stored CRD versions, image/config state,
and a recovery point. It runs every upstream-required pre/post step and storage migration, gating each
stage on readiness.

Binary rollback is supported only while the previous bundle is compatible with the current stored
CRD versions. After an irreversible migration, downgrade fails closed and the operator must restore
the recovery point or forward-fix. Uninstall removes only resources proven safe and Falcone-owned;
CRDs and tenant workload state are retained by default. Destructive purge is a separately confirmed,
documented operation with backup and impact enumeration.

### D8: Keep repository ownership and release gates explicit

`gntik-ai/falcone` owns:

- the mode/readiness configuration and API contract;
- Function and hosted MCP gates, errors, pending cleanup, isolation, audit, and metrics;
- console status/permission/accessibility behavior;
- black-box/persona acceptance and detailed installation/operations documentation.

`gntik-ai/falcone-charts` owns:

- vendoring and provenance for Knative Serving/Kourier;
- the separate install phases, CRDs, cluster RBAC, namespaces, webhooks, controllers, and networking;
- Harbor rewrite/digest policy and the `restricted-v2` Kourier patch;
- ownership preflight, lifecycle orchestration, and disposable cluster acceptance assets.

Neither repository may independently declare the feature available. Release requires coordinated
versions and passing acceptance in both repositories.

## Data and control flow

```text
installer selects mode
        |
        +-- disabled --> publish disabled status --> non-Knative install continues
        |
        +-- external --> read-only compatibility/readiness probes
        |                    |
        |                    +-- ready ------> Function/MCP gates open
        |                    +-- unavailable -> 503 KNATIVE_UNAVAILABLE
        |
        +-- managed --> authority + collision + provenance preflight
                             |
                             +-- fail --> zero mutation + actionable result
                             +-- pass --> CRDs -> RBAC/webhooks -> Serving -> Kourier
                                                        |
                                                        +-- smoke ksvc succeeds -> gates open
                                                        +-- stage fails -> unavailable + evidence
```

The status record contains no credentials. Audit events carry actor, action, mode, owner, bundle,
stage/result, and correlation ID; metrics use bounded dimensions and never tenant-controlled names.

## Migration and rollout

1. Land the design after independent review, keep current docs authoritative, and leave the OpenSpec
   change active until the coordinated implementation and acceptance tasks are complete.
2. Implement the chart-side bundle, provenance, security patch, preflight, phases, and tests under
   [gntik-ai/falcone-charts#8](https://github.com/gntik-ai/falcone-charts/issues/8), behind an
   unavailable-by-default feature gate.
3. Implement Falcone runtime contracts, readiness, errors, pending cleanup, status UI, audit, metrics,
   and tests under [gntik-ai/falcone#933](https://github.com/gntik-ai/falcone/issues/933), against
   compatible chart outputs.
4. Prove fresh managed install, Function and MCP journeys, isolation, outage/recovery, air-gap, upgrade,
   rollback boundary, retain uninstall, and ownership collisions on disposable Kubernetes and remote
   OpenShift environments with cluster-admin authority.
5. Independently audit authorization, contracts, UX/accessibility, docs, deployment, and teardown.
6. Publish coordinated versions and only then document `managed` as supported.

For existing installations, no default-mode conversion occurs. Operators select `external` to retain
their existing serving layer, `disabled` to run without dependent workloads, or follow an explicit
reviewed migration to a cleanly owned `managed` bundle.

## Risks / Trade-offs

- **Cluster blast radius:** CRDs, webhooks, and shared controllers affect the cluster. Mitigated by a
  separate privileged phase, fail-closed authority/ownership checks, and staged readiness.
- **Unsupported Red Hat path:** raw upstream Knative is technically valid Kubernetes, while Red Hat's
  documented OpenShift Serverless product path uses its Operator. Documentation must state that
  distinction and the chosen support responsibility.
- **CRD irreversibility:** storage migrations can prevent binary downgrade. Mitigated by one-minor
  upgrades, recovery records, compatibility gates, retain-by-default uninstall, and forward repair.
- **Supply-chain drift:** mutable or public image references break reproducibility/air-gap. Mitigated
  by provenance locking, digest-only validation, SBOM/licenses, and mirror-only acceptance.
- **OpenShift admission drift:** upstream security contexts may conflict with SCC changes. Mitigated
  by an explicit patch, manifest policy tests, and real `restricted-v2` admission/runtime tests.
- **Shared-runtime isolation:** one control plane serves multiple tenants. Existing namespace, RBAC,
  NetworkPolicy, routing, and cleanup invariants remain mandatory and receive adversarial tests.
- **Remote acceptance gap:** the current remote cluster is already owned and current credentials are
  namespace-scoped. This design records the limitation; it does not treat discovery as install proof.

## Validation evidence and references

- Falcone vendored manifests: `deploy/kind/knative/serving-crds.yaml`,
  `deploy/kind/knative/serving-core.yaml`, and `deploy/kind/knative/kourier.yaml`.
- [Knative installation overview](https://knative.dev/docs/install/)
- [Knative Serving YAML installation](https://knative.dev/docs/install/yaml-install/serving/install-serving-with-yaml/)
- [Knative Serving installation files](https://knative.dev/docs/install/yaml-install/serving/serving-installation-files/)
- [Knative upgrade guidance](https://knative.dev/docs/install/upgrade/upgrade-installation/)
- [Knative uninstall guidance](https://knative.dev/docs/install/uninstall/)
- [Helm CRD lifecycle guidance](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/)
- [Red Hat OpenShift Serverless installation guide](https://docs.redhat.com/en/documentation/red_hat_openshift_serverless/1.37/html-single/installing_openshift_serverless/installing_openshift_serverless)

## Acceptance prerequisite still to provision

The lifecycle executor, ownership model, initial compatibility matrix, and product-support boundary
are resolved above. Delivery remains blocked from release—not from implementation—until the operator
provisions a disposable remote OpenShift 4.21 environment with cluster-admin authority for destructive
clean-install, upgrade, handoff, and teardown acceptance. The currently designated project is valid
only for read-only discovery because Knative already exists and the identity is namespace-scoped.
