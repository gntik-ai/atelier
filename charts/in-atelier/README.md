# In Atelier Helm deployment guide

This chart now ships as an **umbrella chart** with one reusable `component-wrapper` subchart aliased per platform dependency:

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
2. `values/<environment>.yaml` — environment overlay
3. `values/customer-reference.yaml` — customer/tenant overlay
4. `values/platform-<platform>.yaml` — Kubernetes or OpenShift overlay
5. `values/airgap.yaml` — private-registry / air-gapped overlay when needed
6. `values/local.yaml` — untracked workstation override copied from `values/local.example.yaml`

Runtime secret references remain in Helm values, but secret material must stay out of git.

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
  -f charts/in-atelier/values/dev.yaml \
  -f charts/in-atelier/values/customer-reference.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml
```

## Install on OpenShift

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-staging \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/staging.yaml \
  -f charts/in-atelier/values/platform-openshift.yaml
```

## Install with air-gap/private-registry constraints

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  -f charts/in-atelier/values/airgap.yaml
```

## Install only selected components

Disable wrappers you do not want to deploy and optionally point public bindings to externally managed services:

```bash
helm upgrade --install in-atelier charts/in-atelier \
  --namespace in-atelier-dev \
  --create-namespace \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/dev.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  --set postgresql.enabled=false \
  --set mongodb.enabled=false \
  --set kafka.enabled=false \
  --set publicSurface.bindings.identity.serviceName=external-keycloak
```

## Preflight checks

Run the repository validations before packaging or promotion:

```bash
npm run validate:deployment-chart
npm run validate:deployment-topology
npm run validate:image-policy
npm run test:unit
npm run test:contracts
```

## Upgrade flow

1. Render or diff the intended values stack for the target environment.
2. Rebuild dependencies if the wrapper chart changed.
3. Run the validation commands above.
4. Apply the upgrade with the same ordered values files used during installation.
5. Capture the Helm revision, values set, and promoted image tags in the deployment evidence trail.

Example:

```bash
helm dependency build charts/in-atelier
helm upgrade in-atelier charts/in-atelier \
  --namespace in-atelier \
  -f charts/in-atelier/values.yaml \
  -f charts/in-atelier/values/prod.yaml \
  -f charts/in-atelier/values/platform-kubernetes.yaml \
  --history-max 20
```

## Rollback flow

1. Inspect release history.
2. Roll back to the last known good revision.
3. Reapply the last known good values stack if the failure came from configuration drift.
4. Verify the public endpoints, enabled component set, and secret references.

```bash
helm history in-atelier --namespace in-atelier
helm rollback in-atelier <REVISION> --namespace in-atelier
```

## Operational notes

- `publicSurface.bindings.*` controls which service backs each public hostname/path.
- `global.privateRegistry.*` plus `values/airgap.yaml` provide the air-gapped install profile.
- Each component wrapper exposes image, replicas, resources, affinity, tolerations, service, and persistence settings directly in Helm values.
- The chart favors OpenShift-safe defaults (`runAsNonRoot`, restricted security context, Route support) while keeping Kubernetes parity through the same umbrella contract.
