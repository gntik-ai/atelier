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

## Bootstrap controller baseline

`US-DEP-02` adds a post-install/post-upgrade bootstrap job that separates:

- **create-only / one-shot bootstrap**
  - platform Keycloak realm
  - superadmin user + realm role assignment
  - governance catalog seed (`plans`, `quota-policies`, `deployment-profiles`)
  - internal namespace/prefix catalog for OpenWhisk and storage
- **reconcile-on-every-upgrade**
  - APISIX route definitions
  - bootstrap payload ConfigMap that feeds the job

The job uses:

- a **ConfigMap lock** to refuse concurrent executions
- a **ConfigMap marker** with the one-shot payload hash to skip duplicate create-only work on reinstall/upgrade/restore
- idempotent provider calls (`GET if exists`, `PUT for APISIX routes`, `create only if missing` for one-shot catalogs)

### Secret-resolution strategy

Sensitive bootstrap inputs are modeled under `bootstrap.secretResolution.sources` and support three strategies:

1. `kubernetesSecret` — default; rendered as `secretKeyRef`
2. `env` — use a pre-injected pod environment variable from `bootstrap.job.extraEnv`
3. `externalRef` — document an external secret manager reference while still resolving the runtime value through an injected env var

Repository-tracked values must never contain plaintext credentials.

#### Example: existing Kubernetes Secret

```yaml
bootstrap:
  secretResolution:
    sources:
      keycloakAdminPassword:
        strategy: kubernetesSecret
        envVarName: BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD
        existingSecret:
          name: in-atelier-keycloak-admin
          key: password
```

#### Example: pre-injected env var

```yaml
bootstrap:
  job:
    extraEnv:
      - name: BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD
        valueFrom:
          secretKeyRef:
            name: runtime-bootstrap-secrets
            key: kc-password
  secretResolution:
    sources:
      keycloakAdminPassword:
        strategy: env
        envVarName: BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD
```

#### Example: external secret reference metadata

```yaml
bootstrap:
  secretResolution:
    sources:
      apisixAdminKey:
        strategy: externalRef
        envVarName: BOOTSTRAP_APISIX_ADMIN_KEY
        externalRef:
          provider: external-secrets
          reference: secret/data/in-atelier/platform/apisix-admin
```

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
5. Wait for the post-upgrade bootstrap job to reconcile APISIX routes and confirm the bootstrap marker hash updated.
6. Capture the Helm revision, values set, and promoted image tags in the deployment evidence trail.

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

## Rollback / restore flow

1. Inspect release history.
2. Roll back to the last known good revision.
3. Reapply the last known good values stack if the failure came from configuration drift.
4. Verify the public endpoints, enabled component set, and secret references.
5. If a restore recreates the namespace, keep the marker and governance/internal catalog ConfigMaps when possible; if they are missing, the bootstrap job recreates only the missing one-shot resources.
6. Never remove the bootstrap lock or marker unless you are intentionally performing operator-supervised break-glass recovery.

```bash
helm history in-atelier --namespace in-atelier
helm rollback in-atelier <REVISION> --namespace in-atelier
kubectl get configmap in-atelier-bootstrap-state --namespace in-atelier
kubectl get jobs --namespace in-atelier | grep bootstrap
```

## Operational notes

- `publicSurface.bindings.*` controls which service backs each public hostname/path.
- `bootstrap.reconcile.apisix.routes` is the declarative source of truth for the base APISIX routes.
- `bootstrap.oneShot.governanceCatalog.*` mirrors the canonical governance catalog in `services/internal-contracts/src/domain-model.json`.
- `global.privateRegistry.*` plus `values/airgap.yaml` provide the air-gapped install profile.
- Each component wrapper exposes image, replicas, resources, affinity, tolerations, service, and persistence settings directly in Helm values.
- The chart favors OpenShift-safe defaults (`runAsNonRoot`, restricted security context, Route support) while keeping Kubernetes parity through the same umbrella contract.
