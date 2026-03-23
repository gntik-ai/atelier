# In Atelier Helm deployment guide

This chart ships as an **umbrella chart** with one reusable `component-wrapper` subchart aliased per platform dependency:

- `apisix`
- `keycloak`
- `postgresql`
- `mongodb`
- `kafka`
- `openwhisk`
- `storage`
- `observability`
- `controlPlane`
- `webConsole`

The default install profile enables the full platform, while every component can be disabled from Helm values without editing templates.

## Values layering model

Apply values in this order:

1. `values.yaml` — common defaults
2. `values/profiles/<profile>.yaml` — optional deployment profile overlay (`all-in-one`, `standard`, `ha`)
3. `values/<environment>.yaml` — environment overlay
4. `values/customer-reference.yaml` — customer/tenant overlay
5. `values/platform-<platform>.yaml` — Kubernetes or OpenShift overlay
6. `values/airgap.yaml` — private-registry / air-gapped overlay when needed
7. `values/local.yaml` — untracked workstation override copied from `values/local.example.yaml`

Runtime secret references remain in Helm values, but secret material must stay out of git.

## Recommended deployment profiles

- `all-in-one`: smallest footprint for demos, local clusters, and constrained sandboxes.
- `standard`: balanced default for shared non-production and moderate production-like installs.
- `ha`: higher replica counts plus anti-affinity for stateless entry points. Use this with externally managed or separately hardened stateful dependencies when strict HA is required.

The base chart defaults to `deployment.profile=standard`. Select another profile by inserting the matching overlay immediately after `values.yaml`.

## Package the chart

```bash
helm dependency build charts/in-atelier
helm package charts/in-atelier --destination dist/charts
```

## Install the full platform on Kubernetes

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-dev \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/dev.yaml \
  -f charts/in-atelier/values/customer-reference.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml
```

## Install an all-in-one profile for a compact cluster

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-dev \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/all-in-one.yaml \
  -f charts/in-atelier/values/dev.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml
```

## Install the HA profile on Kubernetes

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/ha.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml
```

## Install on OpenShift

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-staging \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/staging.yaml \
  -f charts/in-atelier/values/platform-openshift.yaml
```

## Install with a Kubernetes LoadBalancer and external TLS

Use this only when an external load balancer, cloud edge, or appliance terminates TLS. The chart validates `publicSurface.tls.mode=external` for this exposure mode.

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-prod \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes-loadbalancer.yaml
```

## Install with air-gap/private-registry constraints

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  -f charts/in-atelier/values/airgap.yaml
```

The chart supports two mirror patterns:

- explicit per-image mirror repositories in `values/airgap.yaml`
- global registry rewriting via `global.imageRegistry`, which preserves the image path while swapping the registry host

Private-registry pull secrets are sourced from `global.imagePullSecrets` and `global.privateRegistry.pullSecretNames`.

## Install only selected components

Disable wrappers you do not want to deploy and optionally point public bindings to externally managed services:

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-dev \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/dev.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  --set postgresql.enabled=false \
  --set mongodb.enabled=false \
  --set kafka.enabled=false \
  --set publicSurface.bindings.identity.serviceName=external-keycloak
```

## Security and OpenShift compatibility defaults

- Pod security defaults merge global non-root settings with component-specific overrides.
- Component service accounts default to `automountToken=false`.
- Stateful workloads keep `fsGroup`-based access, `seccompProfile=RuntimeDefault`, and `runAsNonRoot=true` defaults.
- Optional `volumePermissions` init containers are available for storage classes that ignore group ownership updates, but they stay disabled by default to preserve OpenShift `restricted-v2` compatibility.
- LoadBalancer exposure is restricted to direct in-cluster component Services and does not support external `serviceName` bindings.

## Corporate proxies, internal certificates, and network policies

### Network policies

If the cluster enforces default deny:

- allow ingress from the chosen exposure controller (`Ingress`, `Route`, or external LoadBalancer path) to the public Services
- allow namespace-local traffic between APISIX, control-plane, console, identity, and stateful dependencies
- allow DNS, metrics, and storage egress before narrowing policies

### Corporate proxies

Inject proxy settings through component `env` values or environment-specific overlays. At minimum, keep namespace-local DNS, service suffixes, and cluster CIDRs in `NO_PROXY` so east-west traffic stays direct.

### Internal certificates

Mount internal CA bundles through `extraVolumes` and `extraVolumeMounts`, or by adding a ConfigMap-backed trust store to the component image contract. Keep certificate data outside git and reference only the ConfigMap or Secret name from values.

## Preflight checks

Run the repository validations before packaging or promotion:

```bash
npm run validate:deployment-chart
npm run validate:deployment-topology
npm run validate:image-policy
npm run test:unit
npm run test:contracts
npm run test:e2e:deployment
```

## Upgrade flow

1. Render or diff the intended values stack for the target environment.
2. Rebuild dependencies if the wrapper chart changed.
3. Run the validation commands above.
4. On in-place upgrades, set `deployment.upgrade.currentVersion` to the currently deployed chart application version.
5. Apply the upgrade with the same ordered values files used during installation.
6. Capture the Helm revision, selected profile, values set, and promoted image tags in the deployment evidence trail.

Example (`0.2.0 -> 0.3.0`):

```bash
helm dependency build charts/in-atelier
helm upgrade in-atelier charts/in-atelier \
  --namespace in-atelier \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/profiles/standard.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  --set deployment.upgrade.currentVersion=0.2.0 \
  --history-max 20
```

The chart blocks unsupported in-place upgrades and downgrade attempts unless operators explicitly opt into a different policy.

## Rollback flow

1. Inspect release history.
2. Roll back to the last known good revision.
3. Reapply the last known good values stack if the failure came from configuration drift.
4. Verify the public endpoints, selected deployment profile, enabled component set, and secret references.

```bash
helm history in-atelier --namespace in-atelier
helm rollback in-atelier <REVISION> --namespace in-atelier
```

## Operational notes

- `publicSurface.bindings.*` controls which service backs each public hostname/path.
- `publicSurface.tls.mode=clusterManaged` keeps TLS secrets bound inside the charted exposure layer; `external` is intended for LoadBalancer or externally terminated edge paths.
- `global.privateRegistry.*`, `global.imageRegistry`, and `values/airgap.yaml` provide the private-registry / disconnected install model.
- Each component wrapper exposes image, replicas, resources, affinity, tolerations, service, persistence, init containers, security context, and file-permission helpers directly in Helm values.
- The chart favors OpenShift-safe defaults (`runAsNonRoot`, `automountToken=false`, restricted SCC-compatible settings, and Route support) while keeping Kubernetes parity through the same umbrella contract.
