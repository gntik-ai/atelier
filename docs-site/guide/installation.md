# Installation

Falcone is installed from the umbrella Helm chart in the sibling chart repository:

```text
../falcone-charts/charts/in-falcone
```

The C-25 chart version in `Chart.yaml` is `0.3.1`. Use it only with a compatible `0.3.1`
control-plane image. The same chart is released as:

```text
oci://ghcr.io/gntik-ai/charts/in-falcone
```

Clone the chart repository as a sibling of this application repository:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## Choose a guide

| Goal | Guide |
| --- | --- |
| Try Falcone locally on kind | [Quickstart: kind](/guide/quickstart) |
| Install on remote Kubernetes | [Kubernetes Install](/operations/kubernetes-install) |
| Install on OpenShift | [OpenShift Install](/operations/openshift-install) |
| Install on OpenShift with private Harbor or air-gap constraints | [OpenShift Install](/operations/openshift-install#openshift-with-harbor-or-air-gap) |

The former [plain-manifest OpenShift/Harbor guide](/operations/openshift-airgapped-harbor) is a
legacy `0.3.0` reference, not a supported install or upgrade choice for C-25/chart `0.3.1`. New,
fresh, and already Helm-managed upgrade deployments must use the matched Helm chart, the
[OpenShift Install guide](/operations/openshift-install), and the
[Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle). Copying only a
newer image into the legacy manifests is unsafe and unsupported. No supported or safely rehearsed
resource-import path moves a manual installation into Helm. Existing manual `0.3.0` installations
must remain pinned to `0.3.0` and continue their existing manual process until a separate
manual-to-Helm migration is approved and rehearsed; webhook key adoption does not import or transfer
ownership of their Kubernetes resources.

## Chart shape

The chart renders the core platform as one release:

- APISIX gateway.
- Keycloak identity.
- PostgreSQL and pgvector.
- FerretDB over DocumentDB-on-PostgreSQL.
- Kafka-compatible event bus.
- SeaweedFS object storage.
- External Secrets Operator and OpenBao.
- Control plane and control-plane executor.
- Web console.
- Temporal and workflow worker for Flows.
- MCP support.
- Observability.
- Bootstrap jobs and credentials.

Functions and hosted MCP servers are runtime-created Knative Services. On OpenShift, that means the
OpenShift Serverless Operator and a `KnativeServing` custom resource are prerequisites before those
runtime-created workloads can run. On kind, this repository includes Knative Serving + Kourier
manifests under `deploy/kind/knative/` for development use.

The chart rejects legacy attempts to remove core services with `<component>.enabled=false` or zero
replica core overrides. Tune sizing, storage, images, network exposure, security context, and
external-service-compatible secret references instead.

## Values layering

Layer values left to right; later files win:

```text
common -> environment -> customer -> platform -> airgap -> localOverride -> secretRefs
```

## External Secrets ownership

The supported all-core install owns the External Secrets Operator, its CRDs, and its validating
webhooks. It is a fresh-cluster path: do not install it into a cluster where those External Secrets
resources are already owned by another Helm release. The current chart requires
`eso.external-secrets.installCRDs=true` and has no supported reuse or adoption values path.

For a quick check before applying the chart:

```bash
if kubectl get crd externalsecrets.external-secrets.io >/dev/null 2>&1; then
  echo "External Secrets is already installed; use a clean cluster for this all-core chart."
  exit 1
fi
```

Typical Kubernetes install:

```bash
helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone --create-namespace \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/standard.yaml \
  --set global.createNamespace=true
```

If your platform team pre-creates namespaces and Projects, omit `--create-namespace`, set
`global.createNamespace=false`, and supply the required namespace labels, pull secrets, and RBAC
outside Helm.

## Exposure

| Platform value | Rendered public surface |
| --- | --- |
| `values/platform-kubernetes.yaml` | Kubernetes `Ingress` |
| `values/platform-kubernetes-loadbalancer.yaml` | Kubernetes `Service` of type `LoadBalancer` |
| `values/platform-openshift.yaml` | OpenShift `Route` |

The rendered public-surface resources are named from the release. For release `falcone`, rendered
Kubernetes and OpenShift names include:

```text
Ingress: falcone-in-falcone-public
Routes:  falcone-in-falcone-api
         falcone-in-falcone-console
         falcone-in-falcone-identity
         falcone-in-falcone-realtime
Job:     falcone-in-falcone-bootstrap
```

## Verify

Use the install guide for your target cluster, then verify the bootstrap job and core workloads:

```bash
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
kubectl -n falcone rollout status deploy/falcone-control-plane --timeout=5m
kubectl -n falcone rollout status deploy/falcone-control-plane-executor --timeout=5m
kubectl -n falcone rollout status deploy/falcone-web-console --timeout=5m
kubectl -n falcone get pods
```

For OpenShift, use the same resource names with `oc`.
