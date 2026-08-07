# Knative Serving without an operator (issue #932)

Status: investigation/design evidence only. No installer, chart, OpenSpec implementation, or cluster mutation is included by this spike.

## Decision

Knative Serving plus Kourier can be installed from upstream YAML without OLM or the Knative/Red Hat Serverless Operator. This is a cluster-scoped platform installation, not an ordinary namespace-only Falcone service: it creates CRDs, ClusterRoles/Bindings, admission webhooks, namespaces and controllers. Falcone should therefore expose three explicit modes rather than silently installing or adopting resources:

* `managed`: a Falcone-owned, versioned bundle and install phase installs and upgrades Knative/Kourier after a fail-closed cluster preflight.
* `external`: Falcone validates discovery plus an administrator-provided, pre-existing canary by read/invoke operations and never writes cluster-scoped or validation resources. Without a readable canary, the runtime remains unverified and dependent workload gates stay closed.
* `disabled`: the Functions capability retains `501 FUNCTIONS_DISABLED`, and hosted MCP retains its existing disabled/unregistered behavior. `KNATIVE_UNAVAILABLE` is reserved for a configured `managed` or `external` runtime that is not ready.

`managed` is a future capability, not current behavior. Existing operator-managed or independently installed clusters must be selected as `external`; automatic adoption, duplicate installation, or simultaneous Operator/Falcone ownership is unsupported. A future handoff is an explicit cutover (quiesce, backup, remove old owner, verify, then enable the new owner).

## Source and upstream evidence

The repository vendors upstream Knative v1.22.1 manifests (import commit `89d66d41`, verify before implementation):

* `deploy/kind/knative/serving-crds.yaml`: 12 Serving CRDs.
* `deploy/kind/knative/serving-core.yaml`: `knative-serving` namespace, cluster RBAC, Serving deployments/services/configuration and three admission webhook configurations.
* `deploy/kind/knative/kourier.yaml`: `kourier-system` namespace, Kourier controller/gateway and cluster RBAC.

The manifests contain no `Subscription`, `OperatorGroup`, OLM object, or operator deployment. They are consequently suitable for a GitOps/raw-manifest installer, subject to cluster-admin authorization. Official guidance describes YAML as the production/GitOps lowest-common-denominator install and also documents operator alternatives:

* [Knative installation overview](https://knative.dev/docs/install/)
* [Serving YAML installation](https://knative.dev/v1.21-docs/install/yaml-install/serving/install-serving-with-yaml/)
* [Serving installation files](https://knative.dev/docs/install/yaml-install/serving/serving-installation-files/)
* [Knative 1.22 release (Kubernetes 1.34 minimum)](https://knative.dev/blog/releases/announcing-knative-v1-22-release/)

The OpenShift documentation's supported product path is the Red Hat Serverless Operator, not these raw upstream manifests ([installation guide](https://docs.redhat.com/en/documentation/red_hat_openshift_serverless/1.37/html-single/installing_openshift_serverless/installing_openshift_serverless)). Thus “possible” and “Red Hat-supported” are separate claims.

## Deployment shape and security constraints

The implementation should make a separate chart/install phase for CRDs and cluster-scoped prerequisites, then wait for CRD discovery. Webhook bootstrap must apply its namespace, service accounts, RBAC, configuration, Service, and webhook Deployment without enabling the `failurePolicy: Fail` AdmissionRegistration objects; only after the Service has endpoints and the certificate exists may it apply those webhook configurations and wait for non-empty CA bundles plus an admission probe. The remaining Serving controllers, Kourier, and end-to-end readiness follow. Helm CRDs are not templated, upgraded, rolled back or deleted by Helm ([Helm CRD guidance](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/)); lifecycle code must own those operations explicitly.

The bundle includes six controller workloads, three HPAs/PDBs, services/configmaps and a certificate secret. Serving activator/autoscaler/controller/queue/webhook and Kourier controller images are digest-pinned. Envoy is currently `docker.io/envoyproxy/envoy:v1.37-latest`, a mutable tag and an air-gap/reproducibility blocker; implementation must mirror it to Harbor and pin an immutable digest (with SBOM/license/provenance lock for every image).

Kourier's upstream pod security context fixes UID/GID `65534`. On OpenShift restricted-v2 the project range is allocated dynamically (for example `1004040000/10000`), so that fixed identity conflicts with SCC admission. Do **not** render a UID discovered from a namespace annotation. Patch the manifest to remove explicit `runAsUser` and `runAsGroup`, retain `runAsNonRoot`, `seccompProfile: RuntimeDefault`, and dropped capabilities, and let restricted-v2 assign the arbitrary UID. Validate this with `oc adm policy scc-subject-review`/server-side dry-run under an authorized test project.

Installation requires cluster-scoped create/update/delete for CRDs, namespaces, ClusterRoles/Bindings and webhook configurations, plus workload permissions. A namespace editor (including the current remote test identity) cannot perform a clean install safely.

## Ownership and lifecycle contract

Managed mode is executed by a versioned client-side lifecycle command shipped by `falcone-charts`, using a separate `falcone-knative` release and no long-lived Falcone operator. It stamps a Falcone ownership/provenance marker containing release, upstream version/commit, checksums and image digests. The initial supported matrix is Knative Serving/Kourier 1.22.1 on Kubernetes 1.34 and OpenShift 4.21 under `restricted-v2`; other versions fail closed until independently accepted. Falcone owns support for its patched upstream bundle, which is not the Red Hat-supported OpenShift Serverless product path.

Preflight fails if any managed resource already exists with another owner. Uninstall retains CRDs and user Serving objects by default; destructive CRD/data purge requires an explicit confirmation and backup. Upgrades follow Knative's one-minor-at-a-time rule, run required storage migration/post jobs, wait for admission and data-plane readiness, and do not offer downgrade after a migration ([upgrade guide](https://knative.dev/docs/install/upgrade/upgrade-installation/)). Rollback is to the previous known-good controller/image set only when no irreversible migration has occurred. YAML uninstall details are documented by Knative ([uninstall](https://knative.dev/docs/install/uninstall/)).

Operator-managed, Falcone-managed and external installations are mutually exclusive owners. The preflight must detect existing Knative APIs/resources and select `external` or fail closed; it must never “adopt” an Operator's objects. Air-gapped installations require a Harbor mirror, pull-secret wiring and an auditable digest allow-list.

## Falcone integration impact

Functions continue to use Knative Service (`ksvc`) semantics for deploy, invoke, revision status, rollback and delete. They need a readiness gate and typed degraded errors when a configured `managed` or `external` runtime is unavailable; UI/API must not expose a create action that cannot succeed. Deletes and tenant teardown accepted during an outage must atomically persist an idempotent pending-cleanup obligation, return an explicit pending state, and never claim completion before the runtime resource is gone. MCP hosting/tool teardown follows the same rule, deletes only Falcone-owned resources, and leaves an external Knative installation intact. Audit events and metrics should identify mode, release and readiness without leaking image-pull secrets.

Repository ownership should be split: `falcone` owns mode configuration, preflight contract, readiness/error semantics, function/MCP integration, docs and black-box tests; `falcone-charts` owns the vendored bundle/templates, CRD/install phases, SCC-safe Kourier patch, Harbor rewrites, ownership labels and lifecycle hooks.

Implementation is decomposed into [gntik-ai/falcone#933](https://github.com/gntik-ai/falcone/issues/933) for the runtime/product contract and [gntik-ai/falcone-charts#8](https://github.com/gntik-ai/falcone-charts/issues/8) for the bundle and lifecycle. They must be released and accepted together.

## Remote OpenShift evidence (read-only)

Read-only checks used the designated remote OpenShift kubeconfig/context and project; no resources were created or changed. The cluster is OpenShift 4.21.21/Kubernetes 1.34.8 and advertises both `serving.knative.dev` and `operator.knative.dev` APIs. The test identity can CRUD a project-scoped `ksvc` but cannot create/read CRDs, ClusterRoles, namespaces or webhook configurations, and cannot inspect the existing `knative-serving` control plane. Therefore a clean-install verification is blocked by authorization and by an already-present Knative control plane; attempting an operator-free install would risk duplicate ownership. Future implementation acceptance must use a disposable, cluster-admin-controlled OpenShift project/cluster or an equivalent clean cluster and prove teardown.
