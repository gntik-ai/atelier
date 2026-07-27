# Start Here: DevOps / Operator

Use this path when you own the cluster, registry, storage classes, exposure, security context, or
backup plan.

## Source of truth

The deployment source is the sibling Helm chart:

```text
../falcone-charts/charts/in-falcone
```

The C-25 chart source in `Chart.yaml` is `0.3.1`. Use it only with a compatible control-plane image
and after its release/live-verification gates complete. The chart is published as:

```text
oci://ghcr.io/gntik-ai/charts/in-falcone
```

The repo-local install convention is to clone `falcone-charts` as a sibling of this application
repository:

```bash
git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## Choose an install path

| Target | Guide | Exposure object | Platform values |
| --- | --- | --- | --- |
| Local evaluation on kind | [Quickstart: kind](/guide/quickstart) | Port-forward for the quickstart, Ingress render for public surface | `values/dev.yaml`, `values/platform-kubernetes.yaml`, `values/profiles/all-in-one.yaml` |
| Remote Kubernetes | [Kubernetes Install](/operations/kubernetes-install) | `Ingress` | `values/prod.yaml`, `values/platform-kubernetes.yaml`, profile values |
| OpenShift | [OpenShift Install](/operations/openshift-install) | `Route` | `values/prod.yaml`, `values/platform-openshift.yaml`, profile values |
| OpenShift with internal Harbor | [OpenShift Install](/operations/openshift-install#openshift-with-harbor-or-air-gap) | `Route` | OpenShift values plus `deploy/openshift/values-openshift.yaml` |

The [legacy `0.3.0` plain-manifest reference](/operations/openshift-airgapped-harbor) is not a
supported C-25/chart `0.3.1` install or upgrade path. Use the matched Helm/OpenShift path for new,
fresh, and already Helm-managed deployments and the
[Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle); copying only a
newer image into the legacy manifests is unsafe and unsupported. No supported or safely rehearsed
resource-import path moves a manual installation into Helm. Existing manual `0.3.0` installations
must remain pinned to `0.3.0` and continue their existing manual process until a separate
manual-to-Helm migration is approved and rehearsed.

## Required cluster decisions

Before installing, decide:

- Namespace or Project name.
- Whether Helm may create the namespace (`--create-namespace`, `global.createNamespace=true`) or
  whether your platform team pre-creates it (`global.createNamespace=false`).
- Exposure kind: Kubernetes `Ingress`, Kubernetes `LoadBalancer`, or OpenShift `Route`.
- Storage class for stateful services.
- Image source: public registries, a private registry, or an air-gapped Harbor mirror.
- Whether External Secrets Operator and OpenBao are installed by this chart or managed externally.

The chart rejects disabling core services with legacy `<component>.enabled=false` overrides. Tune
replicas, storage, image locations, security contexts, and external-service-compatible secret
references instead.

## Readiness checklist

Use these checks after install:

```bash
kubectl -n falcone get pods
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
kubectl -n falcone rollout status deploy/falcone-control-plane --timeout=5m
kubectl -n falcone rollout status deploy/falcone-control-plane-executor --timeout=5m
kubectl -n falcone rollout status deploy/falcone-web-console --timeout=5m
```

On OpenShift, use `oc` with the same resource names:

```bash
oc -n falcone get route
oc -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
oc -n falcone get pods
```

## Operations next steps

- [Helm Configuration](/operations/helm-configuration) for values layering and supported profiles.
- [Kubernetes Install](/operations/kubernetes-install) for remote Kubernetes.
- [OpenShift Install](/operations/openshift-install) for Route, restricted-v2, and Harbor guidance.
- [Backup & Restore](/operations/backup-restore) for tenant and platform backup evidence.
- [Webhook Signing Master-Key Lifecycle](/operations/webhook-signing-key-lifecycle) for the
  version-coupled install, legacy adoption, rotation, recovery, finalization, and secret-safe
  evidence procedure.
