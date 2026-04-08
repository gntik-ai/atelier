# Installation

This guide covers the full installation of In Falcone on Kubernetes and OpenShift clusters.

## Prerequisites

| Requirement | Minimum Version |
|-------------|----------------|
| Kubernetes | 1.27+ |
| OpenShift | 4.12+ (optional) |
| Helm | 3.12+ |
| kubectl / oc | Matching cluster version |
| pnpm | 10+ (for local development) |
| Node.js | 20+ (for local development) |

### Cluster Resources

For a **standard** deployment profile:

| Resource | Requirement |
|----------|------------|
| CPU | 8 vCPUs (requests), 16 vCPUs (limits) |
| Memory | 8 Gi (requests), 16 Gi (limits) |
| Storage | 200 Gi persistent volumes |
| Nodes | 3+ (for HA) |

::: tip Minimal Setup
For development, the **all-in-one** profile runs with ~4 vCPUs and 4 Gi RAM on a single node.
:::

## Step 1: Clone the Repository

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
```

## Step 2: Prepare the Namespace

::: code-group

```bash [Kubernetes]
kubectl create namespace in-falcone-dev
kubectl config set-context --current --namespace=in-falcone-dev
```

```bash [OpenShift]
oc new-project in-falcone-dev
oc project in-falcone-dev
```

:::

## Step 3: Build Chart Dependencies

```bash
helm dependency build charts/in-falcone
```

## Step 4: Prepare Secrets

In Falcone requires credentials for its infrastructure components. Create a Kubernetes Secret before deploying:

```bash
kubectl create secret generic in-falcone-bootstrap-secrets \
  --namespace in-falcone-dev \
  --from-literal=KEYCLOAK_ADMIN_USER=admin \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD='<strong-password>' \
  --from-literal=APISIX_ADMIN_KEY='<random-api-key>' \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD='<strong-password>' \
  --from-literal=MONGODB_ROOT_USER=root \
  --from-literal=MONGODB_ROOT_PASSWORD='<strong-password>' \
  --from-literal=KAFKA_ADMIN_USER=admin \
  --from-literal=KAFKA_ADMIN_PASSWORD='<strong-password>' \
  --from-literal=MINIO_ROOT_USER=minio \
  --from-literal=MINIO_ROOT_PASSWORD='<strong-password>'
```

::: warning
Never commit credentials to version control. Use a secret manager (Vault, AWS Secrets Manager, etc.) for production environments.
:::

## Step 5: Choose Your Configuration Layers

In Falcone uses a **layered values model**. Stack the layers in order:

```
Base (values.yaml)          ← Always included
  └── Profile               ← Deployment scale
      └── Environment        ← Environment-specific tuning
          └── Platform       ← Kubernetes vs OpenShift specifics
              └── Airgap     ← (Optional) Private registry overrides
                  └── Local  ← (Optional) Untracked developer overrides
```

### Available Profiles

| Profile | Use Case | Replicas | Observability |
|---------|----------|----------|---------------|
| `all-in-one` | Development, CI | 1 per component | Disabled |
| `standard` | Staging, small production | 2-3 per component | Enabled |
| `ha` | Production, regulated | 3+ with anti-affinity | Enabled |

### Available Environments

| Environment | Log Level | Limits | Demo Data |
|-------------|-----------|--------|-----------|
| `dev` | debug | Relaxed | Enabled |
| `staging` | info | Production-like | Disabled |
| `prod` | warn | Strict | Disabled |
| `sandbox` | debug | Relaxed | Enabled |

### Available Platforms

| Platform | Exposure Mode | Notes |
|----------|--------------|-------|
| `platform-kubernetes` | Ingress (nginx) | Standard Kubernetes clusters |
| `platform-openshift` | Route | OpenShift 4.x with restricted-v2 SCC |
| `platform-kubernetes-loadbalancer` | LoadBalancer | External TLS termination |

## Step 6: Deploy

### Development (Kubernetes)

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/all-in-one.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

### Standard (OpenShift)

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-staging \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/staging.yaml \
  -f charts/in-falcone/values/platform-openshift.yaml
```

### Production (HA)

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/ha.yaml \
  -f charts/in-falcone/values/prod.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

### Air-gapped Environment

Add the air-gap overlay to use a private container registry:

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/ha.yaml \
  -f charts/in-falcone/values/prod.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml \
  -f charts/in-falcone/values/airgap.yaml
```

## Step 7: Verify the Deployment

### Check Pod Status

```bash
kubectl get pods -n in-falcone-dev
```

Expected output (all-in-one profile):

```
NAME                               READY   STATUS      RESTARTS   AGE
in-falcone-apisix-xxx              1/1     Running     0          2m
in-falcone-keycloak-xxx            1/1     Running     0          2m
in-falcone-postgresql-0            1/1     Running     0          2m
in-falcone-mongodb-0               1/1     Running     0          2m
in-falcone-kafka-0                 1/1     Running     0          2m
in-falcone-openwhisk-xxx           1/1     Running     0          2m
in-falcone-storage-0               1/1     Running     0          2m
in-falcone-control-plane-xxx       1/1     Running     0          2m
in-falcone-web-console-xxx         1/1     Running     0          2m
in-falcone-bootstrap-xxxxx         0/1     Completed   0          1m
```

### Verify Bootstrap Job

```bash
kubectl logs -n in-falcone-dev job/in-falcone-bootstrap
```

Look for:
- `[bootstrap] Platform realm created`
- `[bootstrap] APISIX routes reconciled`
- `[bootstrap] Governance catalog provisioned`
- `[bootstrap] Bootstrap completed successfully`

### Access the Console

::: code-group

```bash [Kubernetes - Port Forward]
kubectl port-forward -n in-falcone-dev svc/in-falcone-web-console 3000:3000
# Open http://localhost:3000
```

```bash [Kubernetes - Ingress]
# If Ingress is configured:
# https://console.dev.in-falcone.example.com
```

```bash [OpenShift - Route]
oc get route -n in-falcone-staging in-falcone-console -o jsonpath='{.spec.host}'
```

:::

## Step 8: Local Overrides (Optional)

Create a `charts/in-falcone/values/local.yaml` (git-ignored) for workstation-specific tweaks:

```yaml
global:
  namespace: in-falcone-local
  domain: localhost

controlPlane:
  replicas: 1
  env:
    - name: LOG_LEVEL
      value: "debug"

webConsole:
  replicas: 1
```

Then add it as the last layer:

```bash
helm upgrade --install in-falcone charts/in-falcone \
  ... \
  -f charts/in-falcone/values/local.yaml
```

## Uninstalling

```bash
helm uninstall in-falcone -n in-falcone-dev
kubectl delete namespace in-falcone-dev
```

::: danger
This deletes all data including persistent volumes. Ensure backups are taken before uninstalling a production deployment.
:::

## Next Steps

- [Quickstart](/guide/quickstart) — Create your first tenant and workspace
- [Helm Configuration](/operations/helm-configuration) — Deep dive into all configuration options
- [Secret Management](/operations/secret-management) — Production secret management with Vault
