# Helm Configuration

Falcone is configured through the umbrella chart:

```text
../falcone-charts/charts/in-falcone
```

For install walkthroughs, see [Installation](/guide/installation),
[Kubernetes Install](/operations/kubernetes-install), and
[OpenShift Install](/operations/openshift-install).

## Chart identity

The C-25 chart source sets chart and application version `0.3.1`. It declares control-plane minimum
`0.3.1` and webhook key lifecycle `v1`; use that pair only after the image/chart release and live
verification gates complete. The chart is published as:

```text
oci://ghcr.io/gntik-ai/charts/in-falcone
```

The local development convention is a sibling checkout:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## Top-level value sections

| Key | Controls |
| --- | --- |
| `global` | Namespace, environment, air-gap state, private registry, image pull secrets, default storage class, pod security defaults, and the Secret-reference-only `webhookSigningKey` lifecycle contract. |
| `publicSurface` | Public hostnames, route prefixes, Ingress/Route/LoadBalancer settings, and TLS mode. |
| `deployment` | Active sizing profile and values-layer metadata. |
| `platform` | Target platform, exposure kind, OpenShift flag, and security profile. |
| `config` | ConfigMap names, Secret references, and inheritance order. |
| `bootstrap` | Post-install/post-upgrade reconciliation for gateway routes, Keycloak realm/client/superadmin setup, credentials, lock, and marker ConfigMaps. |
| `gatewayPolicy` | APISIX route, scope, OIDC, and rate-limit policy. |
| `apisix`, `keycloak`, `postgresql`, `postgresqlVector`, `documentdb`, `ferretdb`, `kafka`, `seaweedfs`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, `workflowWorker`, `temporal`, `mcp`, `eso`, `openbao` | Core components and support systems. |

Fresh installs render the full core platform. The chart validation rejects legacy service removal
patterns such as `<component>.enabled=false` for core services and zero-replica core overrides.

## Values layering

Layer values left to right; later files win:

```text
common -> environment -> customer -> platform -> airgap -> localOverride -> secretRefs
```

Shell command without inline comments after continuation characters:

```bash
helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone --create-namespace \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/customer-reference.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/standard.yaml \
  --set global.createNamespace=true
```

By default, Helm creates the release namespace with `--create-namespace`, and the chart's namespace
resources are controlled by `global.createNamespace=true`.

For externally managed namespaces, pre-create the namespace, omit `--create-namespace`, and set
`global.createNamespace=false`:

```bash
kubectl create namespace falcone --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/standard.yaml \
  --set global.createNamespace=false
```

## Platform values

| File | Effect |
| --- | --- |
| `values/platform-kubernetes.yaml` | `platform.target: kubernetes`, `platform.network.exposureKind: Ingress`. |
| `values/platform-kubernetes-loadbalancer.yaml` | `platform.network.exposureKind: LoadBalancer`. |
| `values/platform-openshift.yaml` | `platform.target: openshift`, `platform.network.exposureKind: Route`, `platform.securityProfile: restricted-v2`, `platform.openshift.enabled: true`. |
| `values/airgap.yaml` | Enables `global.airgap`, `global.privateRegistry`, image pull secrets, registry CA, and private image repositories. |
| `deploy/openshift/values-openshift.yaml` | OpenShift + Harbor skeleton with placeholder registry, storage class, hostnames, pull secret, CA ConfigMap, and restricted-v2 security context overrides. |

## Profiles

Profiles are under `values/profiles/`:

| File | Use |
| --- | --- |
| `all-in-one.yaml` | Local or single-node evaluation. |
| `standard.yaml` | Normal cluster sizing. |
| `ha.yaml` | Higher-availability sizing for charted services. |

Profile files are the source of truth for replica and persistence choices. Inspect a rendered
upgrade before applying it:

```bash
helm template falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/ha.yaml > /tmp/falcone-render.yaml
```

## Component defaults

Core component aliases include:

```text
apisix
keycloak
postgresql
postgresqlVector
documentdb
ferretdb
kafka
seaweedfs
observability
controlPlane
controlPlaneExecutor
webConsole
workflowWorker
temporal
mcp
eso
openbao
```

The document store is FerretDB over DocumentDB-on-PostgreSQL. Object storage is SeaweedFS. Functions
run as runtime-created Knative Services using the `FN_RUNTIME_IMAGE` value wired into the
control-plane. There is no old MongoDB, MinIO, or OpenWhisk component to enable.

## Public surface

Kubernetes Ingress example:

```yaml
platform:
  target: kubernetes
  network:
    exposureKind: Ingress
publicSurface:
  hostnames:
    api: api.example.com
    console: console.example.com
    identity: iam.example.com
    realtime: realtime.example.com
  tls:
    mode: clusterManaged
```

OpenShift Route example:

```yaml
platform:
  target: openshift
  network:
    exposureKind: Route
  securityProfile: restricted-v2
  openshift:
    enabled: true
publicSurface:
  route:
    annotations:
      haproxy.router.openshift.io/timeout: 30s
```

For release `falcone`, rendered public-surface names include:

```text
Ingress: falcone-in-falcone-public
Routes:  falcone-in-falcone-api
         falcone-in-falcone-console
         falcone-in-falcone-identity
         falcone-in-falcone-realtime
```

## Bootstrap

The post-install/post-upgrade bootstrap job is named:

```text
falcone-in-falcone-bootstrap
```

It reconciles APISIX routes, the Keycloak platform realm, clients, superadmin user, credentials, and
the chart's bootstrap lock/marker state. Verify it with:

```bash
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
```

## Air-gap and private registry

`values/airgap.yaml` enables these global settings:

```yaml
global:
  airgap:
    enabled: true
  privateRegistry:
    enabled: true
    registry: registry.airgap.in-falcone.local
    pullSecretNames:
      - in-falcone-registry
    caBundleConfigMap: in-falcone-registry-ca
  imagePullSecrets:
    - name: in-falcone-registry
  imageRegistry: registry.airgap.in-falcone.local
```

For OpenShift + Harbor, use [OpenShift Install](/operations/openshift-install#openshift-with-harbor-or-air-gap).
The former [no-Helm-at-apply-time guide](/operations/openshift-airgapped-harbor) is a legacy `0.3.0`
reference and is unsupported for new, fresh, or upgrade C-25/chart `0.3.1` deployments. Copying only
a newer control-plane image into those manifests is unsafe and unsupported. Use the matched chart,
the OpenShift install guide, and the
[Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle) only for new,
fresh, or already Helm-managed deployments. No supported or safely rehearsed resource-import path
moves a manual installation into Helm. Existing manual `0.3.0` installations must remain pinned to
`0.3.0` and continue their existing manual process until a separate manual-to-Helm migration is
approved and rehearsed; webhook key adoption does not transfer resource ownership.

For C-25, preserve the control-plane's existing global `DB_URL`/`PG*` Secret wiring. It remains the
tenant/workspace, saga, governance, and workspace-database path and must not be replaced with a
bounded webhook login. The chart correction must add four independently persisted and
TLS-verifying webhook DSNs—`WEBHOOK_SCHEMA_DATABASE_URL`, `WEBHOOK_RUNTIME_DATABASE_URL`,
`WEBHOOK_KEY_WRITE_DATABASE_URL`, and `WEBHOOK_KEY_LIFECYCLE_DATABASE_URL`—plus their declared LOGIN
names and `WEBHOOK_DATABASE_AUTHORITY_GRANTOR_ROLE`. Only the one-shot PostgreSQL bootstrap receives
the administrator DSN. It must run on PostgreSQL 16 or newer, install the exact
`ADMIN`/`INHERIT`/`SET` membership options documented in the
[Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle), and transfer
only the enumerated webhook objects from a proven legacy owner to the bounded schema LOGIN. The
control-plane closes schema and startup-lifecycle pools after verification while retaining global,
webhook-runtime, and webhook-writer pools for serving.

## Schema validation

The chart ships a strict `values.schema.json`. `helm install` and `helm upgrade` validate values by
default. Use `--skip-schema-validation` only when intentionally rendering a partial or experimental
values set for inspection.

Do not skip validation for webhook signing-key work. `global.webhookSigningKey` rejects inline key
material; template validation rejects the reserved `WEBHOOK_SIGNING_KEY` name in
`controlPlane.env`, `global.transportSecurity.env`, and `controlPlane.config.inline`; and lifecycle
validation rejects incomplete actions or a same source/target identity. Follow the complete
[Webhook Signing Master-Key Lifecycle Runbook](/operations/webhook-signing-key-lifecycle); key bytes
must never enter `--set`, a values file, rendered YAML, or Helm history.

### OpenShift build-from-source values

This OpenShift-only contract is nested under `global` because Helm propagates global values into the
aliased component charts. It is disabled by default. Do not enable it on vanilla Kubernetes: the
rendered `BuildConfig` and `ImageStream` resources require OpenShift APIs and its internal registry.

| Key | Type | Default | Required when enabled | Purpose and security |
| --- | --- | --- | --- | --- |
| `global.openshiftBuild.enabled` | boolean | `false` | No | Enables six Docker `BuildConfig` resources, six `ImageStream` resources, four Deployment image-change triggers, and internal runtime pullspecs. |
| `global.openshiftBuild.git.uri` | string | `""` | Yes | Clone URL for the mirrored Falcone monorepo. Builder pods must be able to resolve and reach it. |
| `global.openshiftBuild.git.ref` | string | `main` | No | Git branch, tag, or commit ref used as the source of every build. |
| `global.openshiftBuild.git.sourceSecret` | string | `""` | No | Name of a same-Project Git source Secret for a private mirror. Store credentials only in the Secret, never in values. Empty means no source Secret is mounted. |
| `global.openshiftBuild.webhookSecret` | string | `""` | Yes | Name of a same-Project Secret containing the key `WebHookSecretKey`. It is a reference, not the webhook value. Webhook URLs derived from that value are credentials. |
| `global.openshiftBuild.tag` | string | `latest` | No | Output `ImageStreamTag` and stable tag used by Deployment and dynamic-runtime pullspecs. |
| `global.openshiftBuild.resources.requests.memory` | string | `128Mi` | No | Memory request applied to all six BuildConfigs before a service override. |
| `global.openshiftBuild.resources.limits.memory` | string | `1Gi` | No | Memory limit applied to all six BuildConfigs before a service override. |
| `global.openshiftBuild.serviceResources.web-console.requests.memory` | string | `512Mi` | No | Web-console-specific request merged over the common request. |
| `global.openshiftBuild.serviceResources.web-console.limits.memory` | string | `3Gi` | No | Web-console-specific limit required by its Vite/Monaco production build; merged over the common limit. |

When enabled, internal stream pullspecs take precedence over `repository`, `tag`, and `digest` for
the six released Falcone services only. The chart annotates `control-plane`,
`control-plane-executor`, `web-console`, and `workflow-worker` Deployments for image changes.
`FN_RUNTIME_IMAGE` and `MCP_RUNTIME_IMAGE` point at the `fn-runtime` and `mcp-runtime` streams for
future runtime pods. Images for APISIX, Keycloak, PostgreSQL, and other dependencies are unchanged.
At the defaults, six simultaneous builds declare `1152Mi` of memory requests and `8Gi` of memory
limits. Check Project LimitRanges and build quotas before enabling the mode. Raise or lower the
common and web-console resource maps together only after rehearsing all six builds; a web-console
limit below its documented default can terminate Vite before it emits `dist`.

When disabled, the chart renders no OpenShift Build API resources or image-change annotations and
uses the existing public or private-registry image values. The schema rejects unknown keys and
incorrect types. The templates reject enabled configurations without both
`global.openshiftBuild.git.uri` and `global.openshiftBuild.webhookSecret`.

See [Build-from-source install](/operations/openshift-install#build-from-source-install-openshift-builds).
