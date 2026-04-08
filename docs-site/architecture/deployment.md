# Deployment Topology

In Falcone is deployed via a Helm umbrella chart that supports multiple profiles, environments, and platforms.

## Umbrella Chart

The `charts/in-falcone/` Helm chart uses a **component-wrapper** subchart pattern — a single reusable template that generates Kubernetes resources (Deployment/StatefulSet, Service, PVC, ConfigMap, ServiceAccount) for each platform component.

```
charts/in-falcone/
├── Chart.yaml                    # Umbrella chart (v0.3.0)
├── values.yaml                   # Base values (3000+ lines)
├── values.schema.json            # Value validation schema
├── templates/
│   ├── _helpers.tpl              # Shared template functions
│   ├── namespace.yaml            # Namespace creation
│   ├── bootstrap-job.yaml        # Post-install/upgrade bootstrap
│   ├── bootstrap-rbac.yaml       # Bootstrap RBAC
│   ├── bootstrap-payload-configmap.yaml
│   ├── bootstrap-script-configmap.yaml
│   ├── runtime-configmaps.yaml   # Gateway, control-plane, console config
│   ├── public-surface.yaml       # Ingress / Route / LoadBalancer
│   └── validate.yaml             # ConfigMap validation
├── charts/
│   ├── component-wrapper/        # Reusable workload template (v0.2.0)
│   ├── vault/                    # Vault OSS subchart (v0.1.0)
│   └── eso/                      # External Secrets Operator (v0.1.0)
└── values/
    ├── profiles/                 # Deployment scale profiles
    │   ├── all-in-one.yaml
    │   ├── standard.yaml
    │   └── ha.yaml
    ├── dev.yaml                  # Environment-specific
    ├── staging.yaml
    ├── prod.yaml
    ├── sandbox.yaml
    ├── platform-kubernetes.yaml  # Platform-specific
    ├── platform-openshift.yaml
    ├── platform-kubernetes-loadbalancer.yaml
    ├── airgap.yaml               # Air-gapped environments
    ├── customer-reference.yaml
    └── local.example.yaml        # Local overrides template
```

## Values Layering

Configuration is composed by stacking YAML files in order:

```
┌─────────────────────────────┐
│  6. Local Override          │  (untracked, developer-specific)
├─────────────────────────────┤
│  5. Airgap                  │  (private registry overrides)
├─────────────────────────────┤
│  4. Platform                │  (Kubernetes / OpenShift / LB)
├─────────────────────────────┤
│  3. Environment             │  (dev / staging / prod)
├─────────────────────────────┤
│  2. Profile                 │  (all-in-one / standard / ha)
├─────────────────────────────┤
│  1. Base values.yaml        │  (common defaults)
└─────────────────────────────┘
```

Later layers override earlier ones. This allows composing precise configurations:

```bash
helm upgrade --install in-falcone charts/in-falcone \
  -f charts/in-falcone/values.yaml \                    # 1. Base
  -f charts/in-falcone/values/profiles/standard.yaml \   # 2. Profile
  -f charts/in-falcone/values/staging.yaml \             # 3. Environment
  -f charts/in-falcone/values/platform-openshift.yaml    # 4. Platform
```

## Component Matrix

### Compute Components (Deployment)

| Component | Image | Port | Default Replicas |
|-----------|-------|------|-----------------|
| APISIX | `apache/apisix:3.10.0` | 9080, 9180 | 1 → 2 → 3 |
| Keycloak | `keycloak/keycloak:26.1.0` | 8080 | 1 → 1 → 2 |
| OpenWhisk | `apache/openwhisk-controller:2.0.0` | 3233 | 1 → 2 → 3 |
| Control Plane | `ghcr.io/.../control-plane:0.1.0` | 8080 | 1 → 2 → 3 |
| Web Console | `ghcr.io/.../web-console:0.1.0` | 3000 | 1 → 2 → 3 |
| Prometheus | `prom/prometheus:3.2.1` | 9090 | 0 → 1 → 1 |

### Stateful Components (StatefulSet)

| Component | Image | Port | Storage (dev/std/prod) |
|-----------|-------|------|----------------------|
| PostgreSQL | `bitnami/postgresql:17.2.0` | 5432 | 10Gi / 20Gi / 100-200Gi |
| MongoDB | `bitnami/mongodb:8.0.0` | 27017 | 10Gi / 20Gi / 100-200Gi |
| Kafka | `bitnami/kafka:3.9.0` | 9092 | 20Gi / 50Gi / 200-250Gi |
| MinIO | `minio/minio:2026.3.23` | 9000, 9001 | 20Gi / 100Gi / 500Gi-1Ti |

### Resource Requests

| Component | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|-----------|----------------|-----------|-------------|
| APISIX | 200m | 256Mi | 1 | 1Gi |
| Keycloak | 250m | 512Mi | 1 | 1Gi |
| PostgreSQL | 250m | 512Mi | 1 | 2Gi |
| MongoDB | 250m | 512Mi | 1 | 2Gi |
| Kafka | 300m | 768Mi | 1 | 2Gi |
| OpenWhisk | 250m | 512Mi | 1 | 1Gi |
| MinIO | 250m | 512Mi | 1 | 2Gi |
| Control Plane | 200m | 256Mi | 1 | 1Gi |
| Web Console | 100m | 128Mi | 500m | 512Mi |

## Public Surface Exposure

Three modes for exposing the platform to external traffic:

### Ingress (Kubernetes default)

```yaml
publicSurface:
  mode: ingress
  ingress:
    className: nginx
    tls:
      mode: clusterManaged
    surfaces:
      api:
        host: api.dev.in-falcone.example.com
      console:
        host: console.dev.in-falcone.example.com
      identity:
        host: identity.dev.in-falcone.example.com
      realtime:
        host: realtime.dev.in-falcone.example.com
```

### OpenShift Route

```yaml
publicSurface:
  mode: route
  route:
    tls:
      termination: edge
    surfaces:
      api:
        host: api.staging.in-falcone.example.com
      console:
        host: console.staging.in-falcone.example.com
```

### LoadBalancer

```yaml
publicSurface:
  mode: loadBalancer
  loadBalancer:
    tls:
      mode: external
    surfaces:
      api:
        annotations:
          service.beta.kubernetes.io/aws-load-balancer-type: nlb
```

## Bootstrap Controller

A Kubernetes **Job** that runs post-install and post-upgrade to configure the platform:

### One-Shot Operations (first install only)

1. **Keycloak realm setup**: Create `in-falcone-platform` realm with roles, scopes, clients
2. **Superadmin user**: Create initial admin user with credentials from Secret
3. **Governance catalog**: Provision plans, quota policies, deployment profiles
4. **Internal namespaces**: Create OpenWhisk system namespaces
5. **Storage buckets**: Create `platform-audit` and `platform-artifacts` buckets

### Reconcile Operations (every upgrade)

1. **APISIX routes**: Declaratively reconcile all gateway routes
2. **Bootstrap payload**: Update ConfigMap with latest bootstrap data

### Lock Mechanism

```
ConfigMap: in-falcone-bootstrap-lock
├── locked: true/false
├── lockedBy: <pod-name>
├── lockedAt: <timestamp>
└── payloadHash: <sha256>
```

- Prevents concurrent bootstrap execution
- Skips execution if payload hash matches (no changes)
- Break-glass override available for stuck locks

## Profiles Comparison

| Aspect | All-in-One | Standard | HA |
|--------|-----------|----------|-----|
| **Total Replicas** | ~10 | ~20 | ~30 |
| **Kafka Replicas** | 1 | 3 | 3 |
| **Anti-Affinity** | No | No | Yes |
| **Observability** | Disabled | Enabled | Enabled |
| **Pod Disruption** | None | Basic | Configured |
| **Min CPU** | ~3 cores | ~6 cores | ~10 cores |
| **Min Memory** | ~4 Gi | ~8 Gi | ~16 Gi |
| **Use Case** | Dev, CI | Staging, small prod | Production |

## Air-Gap Support

For disconnected environments, the `airgap.yaml` overlay:

1. Rewrites all image repositories to a private registry
2. Configures image pull secrets
3. Disables external connectivity checks

```yaml
global:
  imageRegistry: registry.internal.example.com
  imagePullSecrets:
    - name: registry-credentials
```
