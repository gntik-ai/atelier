# Legacy 0.3.0 OpenShift/Harbor Plain-Manifest Reference

> [!WARNING]
> **Unsupported for new C-25/chart 0.3.1 installs and upgrades.** These frozen manual manifests
> target Falcone `0.3.0` and omit the mandatory chart-managed webhook signing-key Secret reference,
> credential/lifecycle Jobs, and lifecycle RBAC introduced for C-25. Copying only a newer
> control-plane or other image into these manifests is unsafe and unsupported.
>
> New and fresh users, and users upgrading an existing Helm-managed release, must use the
> [matched Helm chart](/operations/helm-configuration), the
> [OpenShift Install guide](/operations/openshift-install), and the
> [Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle). Existing
> `0.3.0` manual installations must remain pinned to `0.3.0` and continue their existing manual
> process until a separate manual-to-Helm migration is approved and safely rehearsed. No supported
> resource-import path moves these plain-manifest resources into Helm; webhook key adoption does not
> import or transfer ownership of them.

**Legacy scope only.** The remainder of this page records a no-Helm procedure for the historical
`0.3.0` release. It is not an installation choice for C-25/chart `0.3.1`. The archived procedure
describes deploying the **entire Falcone multitenant BaaS platform** on **OpenShift 4.14+** inside a
locked-down enterprise network, using **plain declarative manifests applied with `oc apply -f`
only** — no Helm, Kustomize, or templating tools for the Falcone manifests. OpenShift Serverless is a
prerequisite for the runtime-created Functions and MCP Knative Services. Every image (including
build base images, init containers and sidecars) is pulled **exclusively from a private Harbor
registry**.

**How this legacy reference was produced.** The manifests below were derived from the project's own
deployment source of truth — the umbrella Helm chart `../falcone-charts/charts/in-falcone` (its
`values.yaml`, sub-chart templates and the component-wrapper workload template), the service
`Dockerfile`s, and `tests/env/docker-compose.yml`. Helm was used **only as an off-cluster extraction
aid** to confirm exact env vars, ports, probes and image tags; the operator never runs Helm. Image
tags are taken verbatim from the chart — none were invented. Where a value is unpinned, a
placeholder, or an internal inconsistency exists, it is called out with a **[VERIFY]** note.

## Conventions used throughout

| Placeholder | Meaning | Example |
|---|---|---|
| `${HARBOR}` | Harbor registry host | `harbor.corp.example.com` |
| `${HARBOR_PROJECT}` | Harbor project / path prefix that mirrors all images | `falcone` |
| `${APPS_DOMAIN}` | OpenShift apps wildcard domain (for Routes) | `apps.ocp.corp.example.com` |
| `${OCP_STORAGECLASS}` | Default RWO CSI StorageClass on the cluster | `ocs-storagecluster-ceph-rbd` |

- **Namespace:** the whole platform installs into a single Project named **`falcone`**.
  (The Helm chart uses separate namespaces for OpenBao and ESO ownership; this guide
  consolidates everything into `falcone` for a plain‑manifest install and notes the
  adjustments.)
- **Labels:** every object carries `app.kubernetes.io/part-of: falcone`,
  `app.kubernetes.io/name: <component>`, and `app.kubernetes.io/component: <component>`.
  NetworkPolicies select on `app.kubernetes.io/name`, so keep these labels intact.
- **Image rollout strategy:** every Deployment/StatefulSet **resolves its image
  directly to the Harbor path** (no ImageStream lookup). This is the simplest,
  most deterministic approach for air‑gap and is what every manifest in §7 uses.
  An **optional** `ImageStream` + `image.openshift.io/triggers` pattern for the
  build‑from‑source images is documented in **Appendix B** for sites that prefer
  BuildConfig‑driven rollouts. Because a `Deployment` does not follow an ImageStream
  automatically (unlike the deprecated `DeploymentConfig`), the trigger annotation in
  Appendix B is what wires a rollout to an ImageStream tag.
- **Idempotency:** all commands use `oc apply` (not `oc create`) and are safe to re‑run.

---

## 1. Overview & architecture

Falcone is a modular, multitenant Backend‑as‑a‑Service. The platform decomposes into a
**stateless application tier** (API control plane, data‑plane executor, gateway, auth,
web console), a **stateful data plane** (relational DB, document store, object storage,
message bus), and **operational core services** (observability, secrets manager, flows engine).

### 1.1 Component inventory (what gets deployed)

**Required core**

| Component | Kind | Purpose |
|---|---|---|
| `postgresql` | StatefulSet | Shared relational store (tenant data, governance, Keycloak DB, SeaweedFS filer metadata, Temporal). |
| `documentdb` | StatefulSet | FerretDB backend — PostgreSQL 17 + DocumentDB extension (Mongo‑compatible document store, logical‑replication CDC source). |
| `ferretdb` | Deployment | Stateless MongoDB wire‑protocol gateway in front of `documentdb`. |
| `kafka` | StatefulSet | Event/message bus (events, audit, CDC change streams). KRaft mode. |
| `seaweedfs` (master/volume/filer/s3) | StatefulSets + Deployment | S3‑compatible object storage tier; filer metadata in PostgreSQL. |
| `keycloak` | Deployment | Identity provider (OIDC). One realm per tenant. |
| `apisix` | Deployment | API gateway (edge: validates JWT, injects tenant identity headers). |
| `control-plane` | Deployment | Management/Product API (tenants, IAM, functions admin, storage admin). |
| `control-plane-executor` | Deployment | Data‑plane executor (runs adapter plans against the real backends). |
| `web-console` | Deployment | Operator/tenant web UI (Node static server + same‑origin `/v1` proxy). |
| `observability` (Prometheus) | Deployment | Metrics scraping + storage. |
| `grafana` | Deployment | Dashboards over Prometheus. |
| Bootstrap / init Jobs | Job | Keycloak realm + APISIX routes; DocumentDB extension + logical replication; SeaweedFS bucket + admin identity. |

**Core platform services and runtime-managed capabilities**

| Component | Kind | Purpose |
|---|---|---|
| `openbao` (+ `secret-audit-handler` sidecar) | StatefulSet | Secrets manager (OpenBao, KV‑v2) with file‑audit → Kafka. ESO is the integration path. |
| `temporal` (frontend/history/matching/worker/web) | Deployments + Jobs | Flows engine; `workflow-worker` runs the DSL interpreter. |
| `postgresql-vector` | StatefulSet | Dedicated `pgvector` Postgres for KNN/vector search (dedicated‑DB tenants). |
| MCP runtime RBAC + NetworkPolicy | Role/RoleBinding/NetworkPolicy | Hosting of per‑tenant MCP servers as Knative Services. |
| Functions runtime (`fn-runtime`) | (Knative, created at runtime) | The executor templates a Knative Service per function; image referenced via `FN_RUNTIME_IMAGE`. **Requires OpenShift Serverless.** |

> **[VERIFY] Runtime-created Functions & MCP workloads require OpenShift Serverless
> (Knative).** The core install includes the executor, MCP routes/RBAC, and function
> runtime image references. The executor creates a Knative `Service` per function/server
> at runtime, which needs the **OpenShift Serverless Operator** + a `KnativeServing` CR
> present on the cluster before all-core verification.

### 1.2 Dependency / startup order (mermaid)

```mermaid
graph TD
  subgraph infra["0. Namespace / RBAC / SCC / pull-secret / NetworkPolicies"]
    NS[Project falcone]
  end
  subgraph cfg["1. Secrets + ConfigMaps + PVCs"]
    SEC[Secrets]
    CM[ConfigMaps]
    PVC[PVCs]
  end
  subgraph data["2. Data plane"]
    PG[(postgresql)]
    DDB[(documentdb)]
    KAFKA[(kafka)]
    SW[seaweedfs master→volume→filer→s3]
  end
  subgraph init["3. Init Jobs"]
    DDBINIT[documentdb-init]
    SWSEED[seaweedfs admin-seed + bucket]
  end
  subgraph app["4. Auth + app tier"]
    KC[keycloak]
    FERRET[ferretdb]
    CP[control-plane]
    EX[control-plane-executor]
    GW[apisix gateway]
    WC[web-console]
  end
  subgraph boot["5. Bootstrap Job"]
    BOOT[realm + gateway routes]
  end
  subgraph edge["6. Routes + dashboards"]
    R[Routes: api / console / iam / realtime]
    GRAF[grafana]
    PROM[prometheus]
  end

  NS --> SEC --> data
  CM --> data
  PVC --> data
  PG --> DDB
  PG --> KC
  DDB --> DDBINIT --> FERRET
  SW --> SWSEED
  PG --> CP
  DDB --> CP
  KAFKA --> CP
  SW --> CP
  KC --> CP
  CP --> EX
  CP --> GW
  CP --> WC
  KC --> BOOT
  GW --> BOOT
  BOOT --> R
  PROM --> GRAF
```

**Plain‑English order:** infra → secrets/config/PVCs → `postgresql` → (`documentdb`,
`kafka`, `seaweedfs`) → init Jobs (`documentdb-init`, SeaweedFS seed/bucket) →
`keycloak` → `ferretdb` → `control-plane` → `control-plane-executor` → `apisix` →
`web-console` → bootstrap Job (realm + routes) → `prometheus`/`grafana` → Routes.
OpenBao, Temporal, `postgresql-vector`, and MCP RBAC/routes are baseline services and
slot in after the data plane is healthy.

---

## 2. Prerequisites

1. **OpenShift 4.14+** with the `oc` CLI logged in:

   ```bash
   oc login https://api.ocp.corp.example.com:6443 -u <user>
   oc whoami
   ```

2. **Privileges.**
   - *Namespace‑scoped* operator can apply everything in §4–§7 **except** the
     ClusterRole/ClusterRoleBinding (OpenBao Kubernetes‑auth) and the SCC
     binding, which need **cluster‑admin** (or a one‑time grant by cluster‑admin).
   - Creating the `Project`/`Namespace` needs the `self-provisioner` role or
     cluster‑admin.
3. **StorageClass.** A default RWO CSI StorageClass (`${OCP_STORAGECLASS}`) that supports
   dynamic provisioning and **arbitrary `fsGroup`** (required by `restricted-v2`). Verify:

   ```bash
   oc get storageclass
   ```

4. **Harbor.** A reachable private Harbor with a project (`${HARBOR_PROJECT}`) and a
   **robot account** that can pull. If Harbor uses a private/enterprise CA, have the CA
   PEM ready (used by both the cluster nodes' container runtime and any in‑cluster
   build).
   > **[VERIFY] Node trust for Harbor.** The kubelet/CRI‑O on every node must trust
   > Harbor's TLS (additionalTrustedCA via the cluster's `image.config.openshift.io`
   > and `ImageContentSourcePolicy`/`ImageDigestMirrorSet` are the cluster‑admin way to
   > redirect pulls). Pull secrets alone are not enough if the registry CA is untrusted.
   > Coordinate with the cluster team before install.
5. **Security Context Constraints.** All Falcone pods are designed to run under the
   built‑in **`restricted-v2`** SCC (non‑root, drop ALL capabilities, seccomp
   `RuntimeDefault`, **uid + fsGroup injected from the namespace range**). No custom SCC
   is required for the core. The few upstream images that pin a uid/fsGroup have those
   pins **removed** in this guide (see the per‑component notes) so `restricted-v2`
   admits them.
6. **OpenShift Serverless** installed with a `KnativeServing` CR for functions/MCP
   runtime creation (see §1.1).

---

## 3. Image preparation (air‑gap mirroring into Harbor)

Every image below must be copied into Harbor **before** any manifest is applied. Use
`skopeo copy` from a workstation that can reach *both* the source registry and Harbor
(typically a DMZ / "import" host), or `oc image mirror` from such a host.

### 3.1 Authoritative image version table

Versions are taken verbatim from `../falcone-charts/charts/in-falcone/values.yaml` (and the
`Dockerfile` `FROM` lines for build bases). **Mirror by digest where shown** — the
`ferretdb`/`documentdb` images are already digest‑pinned in the chart; `seaweedfs` is
tag `4.33` in the chart but the OpenShift overlay pins a digest, so pin it.

#### Third‑party images to mirror (`skopeo copy …`)

| Component | Original image:tag (or digest) | Source registry | Harbor target path | Notes |
|---|---|---|---|---|
| PostgreSQL (shared) | `bitnamilegacy/postgresql:17.2.0` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0` | also the Keycloak DB‑init initContainer image |
| PostgreSQL (filer DB init) | `bitnamilegacy/postgresql:17.2.0` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0` | SeaweedFS filer init container (the `bitnami`→`bitnamilegacy` purge) — **[VERIFY]** you may standardize on one tag if you patch the manifest |
| PostgreSQL + pgvector | `pgvector/pgvector:pg17` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/pgvector/pgvector:pg17` | core vector search datastore |
| DocumentDB engine | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7` | ghcr.io | `${HARBOR}/${HARBOR_PROJECT}/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` | digest‑pinned; reused by `documentdb-init` Job + `ferretdb` init container |
| FerretDB gateway | `ghcr.io/ferretdb/ferretdb@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985` (v2.7.0) | ghcr.io | `${HARBOR}/${HARBOR_PROJECT}/ferretdb/ferretdb:2.7.0` | distroless |
| Kafka | `bitnamilegacy/kafka:3.9.0` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/kafka:3.9.0` | KRaft |
| SeaweedFS | `chrislusf/seaweedfs:4.33` (`@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495`) | docker.io | `${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33` | master/volume/filer/s3 + seed/bucket Jobs. **Pin the digest.** |
| Prometheus | `prom/prometheus:v3.2.1@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/prom/prometheus:v3.2.1` | observability; pin the mirrored digest |
| Grafana | `grafana/grafana:11.4.0` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/grafana/grafana:11.4.0` | dashboards |
| Keycloak | `quay.io/keycloak/keycloak:26.1.0` | quay.io | `${HARBOR}/${HARBOR_PROJECT}/keycloak/keycloak:26.1.0` | IdP |
| APISIX | `apache/apisix:3.10.0-debian` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/apache/apisix:3.10.0-debian` | gateway |
| bootstrap helper | `alpine/k8s:1.32.2` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/alpine/k8s:1.32.2` | bootstrap + TLS‑bootstrap Jobs; includes bash, curl, jq, kubectl, and openssl |
| OpenBao | `openbao/openbao:2.3.1` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/openbao/openbao:2.3.1` | core secrets manager (OpenBao; CLI `bao`). Chart + `tests/env` both pin `2.3.1`. |
| Node (OpenBao audit sidecar) | `node:20-alpine` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/library/node:20-alpine` | `secret-audit-handler` sidecar |
| Temporal server | `temporalio/server:1.31.1` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/temporalio/server:1.31.1` | flows frontend/history/matching/worker |
| Temporal admin‑tools | `temporalio/admin-tools:1.31.1` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/temporalio/admin-tools:1.31.1` | schema/bootstrap Jobs |
| Temporal UI | `temporalio/ui:2.51.0` | docker.io | `${HARBOR}/${HARBOR_PROJECT}/temporalio/ui:2.51.0` | flows web UI |

#### Falcone images built from source (push to Harbor; see Appendix B for BuildConfig)

| Component | Image:tag (chart) | Dockerfile | Build base image(s) (also mirror) | Notes |
|---|---|---|---|---|
| control-plane (API) | `in-falcone-control-plane:0.3.0` | `apps/control-plane/Dockerfile` | `node:22-alpine` | release workflow build; validates JWT and dispatches `/v1/*` to real action modules |
| control-plane-executor | `in-falcone-control-plane-executor:0.3.0` | `apps/control-plane-executor/Dockerfile` | `node:22-alpine` | data-plane executor; built from repo root |
| web-console | `in-falcone-web-console:0.3.0` | `apps/web-console/Dockerfile` | `node:22-alpine` | static Node server with zero filesystem writes; build SPA first |
| workflow-worker | `in-falcone-workflow-worker:0.3.0` | `apps/workflow-worker/Dockerfile` | `node:22-slim` (glibc - Temporal core-bridge) | core worker, built from repo root |
| fn-runtime | `in-falcone-fn-runtime:0.3.0` | `apps/fn-runtime/Dockerfile` | `node:22-alpine` | Knative function runtime; referenced via `FN_RUNTIME_IMAGE` |
| mcp-runtime | `in-falcone-mcp-runtime:0.3.0` | `apps/mcp-runtime/Dockerfile` | `node:22-alpine` | first-party MCP JSON-RPC runtime |

Harbor targets for the built images:
`${HARBOR}/${HARBOR_PROJECT}/in-falcone-control-plane:0.3.0`,
`.../in-falcone-control-plane-executor:0.3.0`, `.../in-falcone-web-console:0.3.0`,
`.../in-falcone-workflow-worker:0.3.0`, `.../in-falcone-fn-runtime:0.3.0`,
`.../in-falcone-mcp-runtime:0.3.0`.

The shipped Helm OpenShift overlay preserves the GHCR organization path when
`global.imageRegistry` rewrites first-party images, so that render expects
`${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-*:0.3.0`. The plain manifests in
this guide use the flat paths above. Mirror the six images to the exact path your
manifests reference and do not mix both conventions in one install.

Build bases to mirror (for BuildConfig): `node:22-alpine` and `node:22-slim`
(to `${HARBOR}/${HARBOR_PROJECT}/library/...`).

> **Release image notes (do not silently pick a tag):**
> - `seaweedfs:4.33` is a mutable tag in the chart — **pin to the digest above**.
> - The Falcone-built release set is six images at `0.3.0`: control-plane,
>   control-plane-executor, web-console, workflow-worker, fn-runtime, and mcp-runtime.
>   GitHub Actions run `29152340476` published all six GHCR manifests, including
>   `fn-runtime:0.3.0`. Mirror all six exact tags into Harbor before install.
> - `openbao` is pinned to `2.3.1` in both the chart and `tests/env` (the Vault→OpenBao swap standardized the tag).
> - All other `:tag` refs are mutable; for production, mirror **by digest** and
>   reference the digest in the manifests.

### 3.2 Mirror commands

Authenticate to both registries on the import host, then copy. Example for the
third‑party set (repeat per row; `--all` copies all arches if you need multi‑arch):

```bash
# One-time logins on the DMZ/import host
skopeo login docker.io
skopeo login quay.io
skopeo login ghcr.io
skopeo login ${HARBOR}

# Third-party (digest pins shown where the chart pins them)
skopeo copy docker://docker.io/bitnamilegacy/postgresql:17.2.0    docker://${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0
skopeo copy docker://docker.io/pgvector/pgvector:pg17             docker://${HARBOR}/${HARBOR_PROJECT}/pgvector/pgvector:pg17
skopeo copy docker://ghcr.io/ferretdb/postgres-documentdb@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7 \
            docker://${HARBOR}/${HARBOR_PROJECT}/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0
skopeo copy docker://ghcr.io/ferretdb/ferretdb@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985 \
            docker://${HARBOR}/${HARBOR_PROJECT}/ferretdb/ferretdb:2.7.0
skopeo copy docker://docker.io/bitnamilegacy/kafka:3.9.0                docker://${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/kafka:3.9.0
skopeo copy docker://docker.io/chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495 \
            docker://${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
skopeo copy docker://docker.io/prom/prometheus@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62 \
            docker://${HARBOR}/${HARBOR_PROJECT}/prom/prometheus:v3.2.1
skopeo copy docker://docker.io/grafana/grafana:11.4.0           docker://${HARBOR}/${HARBOR_PROJECT}/grafana/grafana:11.4.0
skopeo copy docker://quay.io/keycloak/keycloak:26.1.0          docker://${HARBOR}/${HARBOR_PROJECT}/keycloak/keycloak:26.1.0
skopeo copy docker://docker.io/apache/apisix:3.10.0-debian     docker://${HARBOR}/${HARBOR_PROJECT}/apache/apisix:3.10.0-debian
skopeo copy docker://docker.io/alpine/k8s:1.32.2                    docker://${HARBOR}/${HARBOR_PROJECT}/alpine/k8s:1.32.2

# Core service support images
skopeo copy docker://docker.io/openbao/openbao:2.3.1           docker://${HARBOR}/${HARBOR_PROJECT}/openbao/openbao:2.3.1
skopeo copy docker://docker.io/library/node:20-alpine          docker://${HARBOR}/${HARBOR_PROJECT}/library/node:20-alpine
skopeo copy docker://docker.io/temporalio/server:1.31.1        docker://${HARBOR}/${HARBOR_PROJECT}/temporalio/server:1.31.1
skopeo copy docker://docker.io/temporalio/admin-tools:1.31.1   docker://${HARBOR}/${HARBOR_PROJECT}/temporalio/admin-tools:1.31.1
skopeo copy docker://docker.io/temporalio/ui:2.51.0            docker://${HARBOR}/${HARBOR_PROJECT}/temporalio/ui:2.51.0

# Build bases (only needed if you build in-cluster via BuildConfig — Appendix B)
skopeo copy docker://docker.io/library/node:22-alpine          docker://${HARBOR}/${HARBOR_PROJECT}/library/node:22-alpine
skopeo copy docker://docker.io/library/node:22-slim            docker://${HARBOR}/${HARBOR_PROJECT}/library/node:22-slim

# Falcone-built release images. If a GHCR tag is not available yet, build it from
# the listed Dockerfile on a connected CI/DMZ host and push the same 0.3.0 target tag.
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-control-plane:0.3.0          docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-control-plane:0.3.0
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-control-plane-executor:0.3.0 docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-control-plane-executor:0.3.0
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-web-console:0.3.0           docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-web-console:0.3.0
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-workflow-worker:0.3.0       docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-workflow-worker:0.3.0
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-fn-runtime:0.3.0            docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-fn-runtime:0.3.0
skopeo copy docker://ghcr.io/gntik-ai/in-falcone-mcp-runtime:0.3.0           docker://${HARBOR}/${HARBOR_PROJECT}/gntik-ai/in-falcone-mcp-runtime:0.3.0
```

> **Build‑from‑source images in air‑gap.** Building Falcone's own images in‑cluster
> (BuildConfig) requires both the base images in Harbor **and the repo source**.
> Cloning from `github.com/gntik-ai/falcone` is typically **blocked** in air‑gap.
> **Recommended:** build the six Falcone images on a connected/DMZ host (or your CI),
> `skopeo copy` them into Harbor, and use only the `Deployment` manifests in §7 — no
> BuildConfig on the cluster. Appendix B documents the BuildConfig alternative (needs an
> internal Git mirror of the repo).

### 3.3 Harbor pull secret + service‑account linking

Create a `docker-registry` Secret in `falcone` and link it to the `default` and
`builder` service accounts so every pod (and any build) can pull from Harbor.

```bash
# After the Project exists (§4.1):
oc -n falcone create secret docker-registry harbor-pull \
  --docker-server=${HARBOR} \
  --docker-username='<robot$falcone+pull>' \
  --docker-password='<ROBOT_TOKEN>' \
  --docker-email='noreply@example.com' \
  --dry-run=client -o yaml | oc apply -f -

# Make it the default pull secret for pods and builds in this namespace:
oc -n falcone secrets link default harbor-pull --for=pull
oc -n falcone secrets link builder harbor-pull --for=pull   # only if using BuildConfig
```

Every Deployment/StatefulSet/Job in §7 *also* lists `imagePullSecrets: [{name: harbor-pull}]`
explicitly, so pulls work even if SA linking is skipped.

> **Harbor CA (optional ConfigMap).** If pods need to trust Harbor's CA for any
> in‑pod HTTPS to the registry (rare; normally node‑level trust suffices — see the
> §2 [VERIFY]), create a ConfigMap and mount it where needed:
>
> ```bash
> oc -n falcone create configmap harbor-ca --from-file=ca.crt=/path/to/harbor-ca.pem
> ```

---

## 4. Namespace & RBAC

Apply these first (file `00-namespace-rbac.yaml`). The Roles are namespace‑scoped; the
function‑executor and MCP Roles grant the control‑plane the rights to manage Knative
Services (only relevant if OpenShift Serverless is present, but harmless otherwise).

```yaml
apiVersion: project.openshift.io/v1
kind: Project
metadata:
  name: falcone
  labels:
    app.kubernetes.io/part-of: falcone
    # Label used by NetworkPolicy namespaceSelectors that reference this namespace.
    kubernetes.io/metadata.name: falcone
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-control-plane
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-control-plane-executor
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane-executor }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-apisix
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-keycloak
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: keycloak }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-web-console
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: web-console }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-postgresql
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-documentdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: documentdb }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-ferretdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: ferretdb }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-kafka
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: kafka }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-observability
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: observability }
---
# SeaweedFS needs an SA whose ClusterRole permits deleting its own StatefulSet pods
# (used by the chart's volume-resize/migration hooks). automountToken stays true.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-seaweedfs
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs }
automountServiceAccountToken: true
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: falcone-bootstrap
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: bootstrap }
---
# --- Bootstrap Role: write the realm/route payload ConfigMaps it reconciles ---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: falcone-bootstrap
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: falcone-bootstrap
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: falcone-bootstrap }
subjects:
  - kind: ServiceAccount
    name: falcone-bootstrap
    namespace: falcone
---
# --- Function executor Role (Knative Services + Job fallback + pod/log read) ---
# Bound to the control-plane SA. Only effective if OpenShift Serverless is installed.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: falcone-function-executor
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
rules:
  - apiGroups: ["serving.knative.dev"]
    resources: ["services"]
    verbs: ["create", "get", "list", "watch", "update", "patch", "delete"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: falcone-function-executor
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: falcone-function-executor }
subjects:
  - kind: ServiceAccount
    name: falcone-control-plane
    namespace: falcone
---
# --- Prometheus pod-discovery Role (read pods/endpoints/services in this ns) ---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: falcone-prometheus-pod-discovery
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
rules:
  - apiGroups: [""]
    resources: ["pods", "endpoints", "services"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: falcone-prometheus-pod-discovery
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: falcone-prometheus-pod-discovery }
subjects:
  - kind: ServiceAccount
    name: falcone-observability
    namespace: falcone
---
# --- SeaweedFS ClusterRole: delete its own pods (chart hook requirement) ---
# CLUSTER-ADMIN required to apply. ClusterRole is needed because the SeaweedFS
# helpers act on pods; scope is pods only.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: falcone-seaweedfs-rw
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs }
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: falcone-seaweedfs-rw
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: falcone-seaweedfs-rw }
subjects:
  - kind: ServiceAccount
    name: falcone-seaweedfs
    namespace: falcone
```

**Non‑obvious fields**
- `Project` carries `kubernetes.io/metadata.name: falcone` explicitly so the
  NetworkPolicies that select this namespace by label match it (the label is auto‑added
  by the API server on modern clusters, but asserting it is safe).
- `falcone-function-executor` / MCP Roles reference `serving.knative.dev` — they are
  inert unless OpenShift Serverless is installed; applying them does not require the CRD
  to exist (RBAC rules over absent API groups are allowed).
- The SeaweedFS `ClusterRole`/`ClusterRoleBinding` are the only **cluster‑scoped**
  objects in the core install and need cluster‑admin.

### 4.1 SCC binding

The core pods are `restricted-v2`‑compatible (non‑root, `drop: [ALL]`, seccomp
`RuntimeDefault`, no pinned uid/fsGroup). `restricted-v2` is the default SCC, so no
binding is normally required. If your cluster default differs, bind it explicitly to the
service accounts (cluster‑admin):

```bash
for sa in falcone-control-plane falcone-control-plane-executor falcone-apisix \
          falcone-keycloak falcone-web-console falcone-postgresql falcone-documentdb \
          falcone-ferretdb falcone-kafka falcone-observability falcone-seaweedfs \
          falcone-bootstrap default; do
  oc adm policy add-scc-to-user restricted-v2 -z "$sa" -n falcone
done
```

> **[VERIFY] Core images that pin a uid.** Upstream `grafana` (uid 472) and
> `openbao` (uid 100) images pin a non‑root uid that is **outside** the namespace range
> and therefore **rejected by `restricted-v2`**. In the core manifests these pins are removed
> (let the SCC inject the uid). If a specific image truly needs a fixed uid, create a
> dedicated SCC with `runAsUser: MustRunAs <uid>` and bind it to that SA only — do not
> use `anyuid` broadly.

### 4.2 NetworkPolicies

Apply `01-networkpolicies.yaml`. These mirror the chart's isolation posture: the
data‑plane datastores accept traffic only from the Falcone app pods (+ intra‑component),
plus DNS egress.

> **[VERIFY] CNI enforcement.** NetworkPolicy is only enforced by a policy‑capable CNI
> (OpenShift SDN / OVN‑Kubernetes both enforce). If your cluster's CNI does not enforce,
> these are advisory only and you must compensate with other controls.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: falcone-ferretdb-internal-only
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: ferretdb }
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/name: ferretdb }
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: control-plane } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: control-plane-executor } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: workflow-worker } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: ferretdb } }
      ports: [{ protocol: TCP, port: 27017 }]
  egress:
    - to: [{ namespaceSelector: {} }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: falcone } }
        - podSelector: {}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: falcone-seaweedfs-internal-only
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: seaweedfs }
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/name: seaweedfs }
  policyTypes: ["Ingress", "Egress"]
  ingress:
    # S3 gateway (8333) from app pods + intra-SeaweedFS.
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: control-plane } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: control-plane-executor } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: workflow-worker } }
        - podSelector: { matchLabels: { app.kubernetes.io/name: seaweedfs } }
      ports: [{ protocol: TCP, port: 8333 }]
    # Intra-SeaweedFS control/data plane + the bucket-provisioning Job.
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: seaweedfs } }
        - podSelector: { matchLabels: { batch.kubernetes.io/job-name: falcone-seaweedfs-bucket } }
      ports:
        - { protocol: TCP, port: 9333 }
        - { protocol: TCP, port: 19333 }
        - { protocol: TCP, port: 8080 }
        - { protocol: TCP, port: 18080 }
        - { protocol: TCP, port: 8888 }
        - { protocol: TCP, port: 18888 }
  egress:
    - to: [{ namespaceSelector: {} }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: falcone } }
        - podSelector: {}
```

**Non‑obvious fields**
- The SeaweedFS bucket Job is admitted by its `batch.kubernetes.io/job-name` label —
  the post‑install bucket creation runs `weed shell` against master/filer and would
  otherwise be dropped by this policy, hanging the install.
- Egress allows DNS to any namespace (kube‑dns) plus same‑namespace pod traffic (the
  filer's PostgreSQL metadata store and intra‑SeaweedFS membership live in `falcone`).

> Add equivalent policies for `postgresql`, `kafka`, `documentdb` if you want the same
> "app‑pods‑only" ingress posture (the chart leaves those open within the namespace and
> relies on the gateway as the only external entry). Templates are identical to
> `ferretdb` with the right port. **[VERIFY]** decide your intra‑namespace posture.

---

## 5. Configuration (Secrets & ConfigMaps)

The chart **does not** create the credential Secrets — they are expected from ESO/OpenBao
or pre‑created. In this plain‑manifest install you create them directly. **Never commit
real secret values**; the YAML below uses placeholders, and the `oc create secret`
commands keep values out of files.

### 5.1 Secrets

Generate strong values once and create the Secrets (file these are NOT committed):

```bash
# Helper to mint random values
rnd() { openssl rand -hex 24; }

PG_APP_PW=$(rnd);  PG_SUPER_PW=$(rnd)
DDB_PW=$(rnd);     DDB_REPL_PW=$(rnd)
S3_AK=$(openssl rand -hex 10); S3_SK=$(rnd)
GW_SHARED=$(rnd);  APISIX_ADMIN=$(rnd)
KC_ADMIN_PW=$(rnd); SUPERADMIN_PW=$(rnd)

# --- Shared PostgreSQL (Bitnami): app role + superuser ---
oc -n falcone create secret generic in-falcone-postgresql \
  --from-literal=POSTGRESQL_USERNAME=falcone \
  --from-literal=POSTGRESQL_PASSWORD="$PG_APP_PW" \
  --from-literal=POSTGRESQL_POSTGRES_PASSWORD="$PG_SUPER_PW" \
  --dry-run=client -o yaml | oc apply -f -

# --- DocumentDB engine (FerretDB backend) ---
oc -n falcone create secret generic in-falcone-documentdb \
  --from-literal=POSTGRES_USER=falcone \
  --from-literal=POSTGRES_PASSWORD="$DDB_PW" \
  --dry-run=client -o yaml | oc apply -f -

# Logical-replication role password (CDC)
oc -n falcone create secret generic in-falcone-documentdb-replication \
  --from-literal=password="$DDB_REPL_PW" \
  --dry-run=client -o yaml | oc apply -f -

# FerretDB gateway -> DocumentDB DSN (note: connects to the `postgres` DB, sslmode=disable in-cluster)
oc -n falcone create secret generic in-falcone-ferretdb \
  --from-literal=postgresql-url="postgres://falcone:${DDB_PW}@falcone-documentdb:5432/postgres?sslmode=disable" \
  --dry-run=client -o yaml | oc apply -f -

# --- Kafka (KRaft, no SASL in this baseline) ---
# [VERIFY] If you enable SASL/SCRAM, add the broker/inter-broker credentials here.
oc -n falcone create secret generic in-falcone-kafka \
  --from-literal=KAFKA_CFG_PLACEHOLDER=unused \
  --dry-run=client -o yaml | oc apply -f -

# --- SeaweedFS S3 admin credentials (the storage backend identity) ---
oc -n falcone create secret generic in-falcone-seaweedfs-s3-creds \
  --from-literal=s3AccessKey="$S3_AK" \
  --from-literal=s3SecretKey="$S3_SK" \
  --from-literal=adminAccessKey="$S3_AK" \
  --from-literal=adminSecretKey="$S3_SK" \
  --dry-run=client -o yaml | oc apply -f -

# SeaweedFS S3 identities file (consumed by the s3 gateway). Must match the creds above.
oc -n falcone create secret generic in-falcone-seaweedfs-s3-config \
  --from-literal=seaweedfs_s3_config="{\"identities\":[{\"name\":\"falcone-s3-admin\",\"credentials\":[{\"accessKey\":\"$S3_AK\",\"secretKey\":\"$S3_SK\"}],\"actions\":[\"Admin\",\"Read\",\"Write\",\"List\",\"Tagging\"]}]}" \
  --dry-run=client -o yaml | oc apply -f -

# Provider-neutral storage secret consumed by control-plane/executor (keys: s3_access_key/s3_secret_key).
# Must mirror the SeaweedFS admin creds above.
oc -n falcone create secret generic in-falcone-storage \
  --from-literal=s3_access_key="$S3_AK" \
  --from-literal=s3_secret_key="$S3_SK" \
  --dry-run=client -o yaml | oc apply -f -

# --- Gateway shared secret (control-plane / executor / apisix attestation) ---
oc -n falcone create secret generic in-falcone-gateway-shared-secret \
  --from-literal=secret="$GW_SHARED" \
  --dry-run=client -o yaml | oc apply -f -

# --- APISIX admin key (bootstrap pushes routes via the Admin API) ---
oc -n falcone create secret generic in-falcone-apisix-admin \
  --from-literal=admin-key="$APISIX_ADMIN" \
  --dry-run=client -o yaml | oc apply -f -

# --- Keycloak: bootstrap admin + the control-plane admin client ---
oc -n falcone create secret generic in-falcone-keycloak-admin \
  --from-literal=username=admin \
  --from-literal=password="$KC_ADMIN_PW" \
  --dry-run=client -o yaml | oc apply -f -

# Keycloak container bootstrap admin (KC_BOOTSTRAP_ADMIN_*). [VERIFY] key names against
# your Keycloak version; 26.x uses KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD.
oc -n falcone create secret generic in-falcone-identity-client \
  --from-literal=KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  --from-literal=KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PW" \
  --dry-run=client -o yaml | oc apply -f -

# Platform superadmin user seeded by the bootstrap Job
oc -n falcone create secret generic in-falcone-superadmin \
  --from-literal=password="$SUPERADMIN_PW" \
  --dry-run=client -o yaml | oc apply -f -
```

> **Required‑Secret reference** (what each is for / who reads it):
>
> | Secret | Keys | Read by |
> |---|---|---|
> | `in-falcone-postgresql` | `POSTGRESQL_USERNAME`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_POSTGRES_PASSWORD` | postgresql SS, keycloak db‑init, control‑plane, temporal schema, seaweedfs filer |
> | `in-falcone-documentdb` | `POSTGRES_USER`, `POSTGRES_PASSWORD` | documentdb SS, documentdb‑init, ferretdb init, control‑plane (`MONGO_USER/PASSWORD`) |
> | `in-falcone-documentdb-replication` | `password` | documentdb‑init (CDC role) |
> | `in-falcone-ferretdb` | `postgresql-url` | ferretdb gateway |
> | `in-falcone-kafka` | *(SASL only)* | kafka SS |
> | `in-falcone-seaweedfs-s3-creds` | `s3AccessKey`, `s3SecretKey`, `adminAccessKey`, `adminSecretKey` | s3 gateway, admin‑seed Job |
> | `in-falcone-seaweedfs-s3-config` | `seaweedfs_s3_config` | s3 gateway |
> | `in-falcone-storage` | `s3_access_key`, `s3_secret_key` | control‑plane, executor |
> | `in-falcone-gateway-shared-secret` | `secret` | apisix, control‑plane, executor |
> | `in-falcone-apisix-admin` | `admin-key` | bootstrap Job |
> | `in-falcone-keycloak-admin` | `username`, `password` | bootstrap Job, control‑plane |
> | `in-falcone-identity-client` | `KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` | keycloak |
> | `in-falcone-superadmin` | `password` | bootstrap Job |
> | `in-falcone-postgresql-vector` *(opt)* | `POSTGRES_USER`, `POSTGRES_PASSWORD` | postgresql‑vector SS |
> | `falcone-seaweedfs-db-secret` *(opt, unused in this baseline)* | `user`, `password` | seaweedfs filer (MySQL store — disabled; we use PostgreSQL) |
>
> **[VERIFY] Consistency notes carried over from the chart:**
> - `in-falcone-storage` (control‑plane env, OpenShift overlay) and
>   `in-falcone-seaweedfs-s3-creds` (chart) are two names for the same S3 admin
>   credential — keep their values identical (the script above does).
> - The OpenShift overlay points the control‑plane at `https://…-seaweedfs-s3:8334`
>   (TLS). This baseline uses **HTTP `:8333`** internally (cluster‑internal,
>   NetworkPolicy‑restricted) — see §7 SeaweedFS. If you require S3‑over‑TLS, enable the
>   HTTPS port and mount a cert, then switch `STORAGE_S3_ENDPOINT` to `https://…:8334`.

### 5.2 ConfigMaps

Apply `02-configmaps.yaml`. These are reproduced from the chart with the namespace
normalized to `falcone` and DNS/hostnames parameterized. Replace `${APPS_DOMAIN}` in the
gateway/console/identity hostnames.

```yaml
# ---- Gateway (APISIX) ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-apisix-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix }
data:
  # [VERIFY] Admin-API mode. The chart default is "true" (standalone YAML), but the
  # bootstrap Job pushes routes via the Admin API (port 9180), which standalone disables.
  # For the bootstrap flow to work, run with the Admin API enabled (false). If instead
  # you mount a static apisix.yaml with routes, set this "true" and skip route bootstrap.
  APISIX_STAND_ALONE: "false"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-gateway-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  environment: "prod"
  exposureKind: "Route"
  tlsMode: "clusterManaged"
  apiHostname: "api.${APPS_DOMAIN}"
  realtimeHostname: "realtime.${APPS_DOMAIN}"
  oidcIssuerUrl: "https://iam.${APPS_DOMAIN}/auth/realms/in-falcone-platform"
  oidcDiscoveryUrl: "https://iam.${APPS_DOMAIN}/auth/realms/in-falcone-platform/.well-known/openid-configuration"
  passthroughMode: "enabled"
  propagatedAuthHeaders: "X-Actor-Username,X-Workspace-Id,X-Plan-Id,X-Actor-Roles,X-Auth-Scopes,X-Auth-Subject,X-Tenant-Id"
  correlationHeader: "X-Correlation-Id"
  requestIdHeader: "X-Request-Id"
  gatewayInternalMode: "validated_attestation"
  errorEnvelopeSchema: "ErrorResponse"
  gatewayMetricsPath: "/apisix/prometheus/metrics"
  gatewayMetricsSeriesPrefix: "in_falcone_event_gateway_"
  realtimePathPrefix: "/realtime"
---
# ---- Control plane ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-control-plane-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane }
data:
  openapiPath: "/control-plane/openapi"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-control-plane-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  diagnostics.logLevel: "info"
  diagnostics.debugEndpoints: "false"
  deploymentProfile: "standard"
  limitsProfile: "relaxed"
---
# ---- Keycloak ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-keycloak-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: keycloak }
data:
  publicPath: "/auth"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-keycloak-db
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  KC_DB_URL: "jdbc:postgresql://falcone-postgresql:5432/keycloak"
---
# ---- Web console ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-web-console-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: web-console }
data:
  auth: "map[clientId:in-falcone-console loginPath:/login passwordRecoveryPath:/password-recovery realm:in-falcone-platform signupPath:/signup]"
  homepageHost: "console.${APPS_DOMAIN}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-web-console-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  consoleHostname: "console.${APPS_DOMAIN}"
  publicBasePath: "/"
  environment: "prod"
---
# ---- Kafka / PostgreSQL behavior flags ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-kafka-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: kafka }
data:
  deliverySemantics: "at-least-once"
  # KRaft single-node baseline (see §7 Kafka). [VERIFY] for HA use Strimzi/per-broker IDs.
  KAFKA_CFG_NODE_ID: "0"
  KAFKA_CFG_PROCESS_ROLES: "controller,broker"
  KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@falcone-kafka-0.falcone-kafka:9093"
  KAFKA_CFG_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093"
  KAFKA_CFG_ADVERTISED_LISTENERS: "PLAINTEXT://falcone-kafka:9092"
  KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT"
  KAFKA_CFG_CONTROLLER_LISTENER_NAMES: "CONTROLLER"
  KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "false"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-postgresql-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql }
data:
  tenantIsolationMode: "schema-per-tenant"
---
# ---- Observability ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-observability-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: observability }
data:
  scrapeModel: "platform-wide"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-prometheus-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 30s
      external_labels:
        cluster: in-falcone
    scrape_configs:
      - job_name: prometheus
        static_configs:
          - targets: ['localhost:9090']
      - job_name: falcone-control-plane
        metrics_path: /metrics
        static_configs:
          - targets: ['falcone-control-plane.falcone.svc.cluster.local:8080']
            labels: { component: control-plane }
      - job_name: falcone-control-plane-executor
        metrics_path: /metrics
        static_configs:
          - targets: ['falcone-control-plane-executor.falcone.svc.cluster.local:8080']
            labels: { component: executor }
      - job_name: falcone-apisix
        metrics_path: "/apisix/prometheus/metrics"
        static_configs:
          - targets: ['falcone-apisix.falcone.svc.cluster.local:9080']
            labels: { component: gateway }
      - job_name: falcone-pods
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: ['falcone']
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: "true"
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            regex: ([^:]+)(?::\d+)?;(\d+)
            replacement: $1:$2
            target_label: __address__
          - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
            action: replace
            target_label: component
          - source_labels: [__meta_kubernetes_namespace]
            action: replace
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            action: replace
            target_label: pod
---
# ---- Grafana provisioning + dashboards ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-grafana-provisioning
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  datasource.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://falcone-observability.falcone.svc.cluster.local:9090
        isDefault: true
  dashboards.yaml: |
    apiVersion: 1
    providers:
      - name: falcone
        orgId: 1
        folder: Falcone
        type: file
        disableDeletion: false
        editable: true
        options:
          path: /var/lib/grafana/dashboards
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-grafana-dashboards
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
data:
  falcone-platform-overview.json: |
    {
      "uid": "falcone-platform", "title": "Falcone — Platform Overview", "schemaVersion": 39, "version": 1,
      "time": {"from": "now-6h", "to": "now"}, "refresh": "30s",
      "panels": [
        {"id": 1, "title": "Request rate (req/s) by component", "type": "timeseries", "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
         "targets": [{"expr": "sum by (component) (rate(falcone_http_requests_total[5m]))", "legendFormat": "{{component}}"}]},
        {"id": 2, "title": "Error rate (5xx, req/s)", "type": "timeseries", "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
         "targets": [{"expr": "sum(rate(falcone_http_requests_total{status=~\"5..\"}[5m]))", "legendFormat": "5xx"}]}
      ]
    }
---
# ---- DocumentDB engine: postgres conf + logical-replication provisioning SQL ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-documentdb-conf
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: documentdb }
data:
  custom.conf: |
    shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb'
    cron.database_name = 'postgres'
  provision-logical-replication.sql: |
    -- 1. REPLICATION-privileged login role.
    SELECT format('CREATE ROLE %I LOGIN REPLICATION PASSWORD %L', :'role', :'pw')
      WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
    SELECT format('ALTER ROLE %I WITH LOGIN REPLICATION PASSWORD %L', :'role', :'pw') \gexec
    -- 2. Grants for the walsender (decode bson columns).
    SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'role')
      FROM pg_namespace WHERE nspname LIKE 'documentdb%' \gexec
    SELECT format('GRANT SELECT ON documentdb_api_catalog.collections TO %I', :'role') \gexec
    -- 3. Scoped publication (idempotent).
    SELECT format('CREATE PUBLICATION %I FOR TABLES IN SCHEMA documentdb_data', :'pub')
      WHERE NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = :'pub') \gexec
    -- 4. REPLICA IDENTITY FULL on existing documents_* tables.
    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents\_%' AND relkind = 'r'
      LOOP EXECUTE format('ALTER TABLE documentdb_data.%I REPLICA IDENTITY FULL', r.relname); END LOOP;
    END $$;
    -- 5. Event trigger to keep RI FULL applied to future documents_* tables.
    CREATE OR REPLACE FUNCTION falcone_documents_ri_full() RETURNS event_trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE obj record; BEGIN
      FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'CREATE TABLE'
      LOOP
        IF obj.schema_name = 'documentdb_data' AND obj.object_identity ~ '\.documents_[0-9]+$' THEN
          EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', obj.object_identity);
        END IF;
      END LOOP;
    END $fn$;
    DROP EVENT TRIGGER IF EXISTS falcone_documents_ri_full_trg;
    CREATE EVENT TRIGGER falcone_documents_ri_full_trg ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION falcone_documents_ri_full();
---
# ---- SeaweedFS filer metadata store (PostgreSQL) ----
apiVersion: v1
kind: ConfigMap
metadata:
  name: in-falcone-seaweedfs-db-init
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: seaweedfs-filer }
data:
  filer.toml: |-
    [leveldb2]
    enabled = false
    [postgres2]
    enabled = true
    createTable = """
    CREATE TABLE IF NOT EXISTS "%s" (
      dirhash   BIGINT,
      name      VARCHAR(65535),
      directory VARCHAR(65535),
      meta      bytea,
      PRIMARY KEY (dirhash, name)
    );
    """
    hostname = "falcone-postgresql"
    port = 5432
    database = "seaweedfs_filer"
    schema = "public"
    sslmode = "disable"
    connection_max_idle = 5
    connection_max_open = 30
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: falcone-seaweedfs-master-config
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs }
data:
  master.toml: |-
    # Extra master configuration (empty by default).
```

**Large generated ConfigMaps (referenced, not inlined).** Three ConfigMaps in the chart
carry large generated payloads. Extract them from the chart render and apply as files
(they are data‑only and namespace‑portable — just set `namespace: falcone`):

| ConfigMap | Content | Size | How to obtain |
|---|---|---|---|
| `falcone-in-falcone-bootstrap-payload` | `realm.json` (full Keycloak realm export: clients, roles, scopes for `in-falcone-platform`) | ~3,800 lines | Render the chart (`helm template … -s templates/bootstrap-payload-configmap.yaml`) on a connected host, or export your realm from a reference Keycloak. **[VERIFY] required for bootstrap.** |
| `falcone-in-falcone-bootstrap-script` | `bootstrap.sh` (creates realm, superadmin, pushes APISIX routes) | ~550 lines | `helm template … -s templates/bootstrap-script-configmap.yaml` |
| `falcone-in-falcone-gateway-policy` | `gateway-policy.json` (access matrix the gateway/tests assert) | ~1,200 lines | `helm template … -s templates/runtime-configmaps.yaml` |

> To produce these three on a connected/DMZ host from this repo:
>
> ```bash
> helm template falcone ../falcone-charts/charts/in-falcone \
>   -s templates/bootstrap-payload-configmap.yaml \
>   -s templates/bootstrap-script-configmap.yaml \
>   -s templates/runtime-configmaps.yaml \
>   > falcone-large-configmaps.yaml
> # then: sed -i 's/^  namespace: .*/  namespace: falcone/' (or set namespace on apply)
> oc -n falcone apply -f falcone-large-configmaps.yaml
> ```
>
> These contain no secrets (the realm references secret *names*, not values).

---

## 6. Storage (PersistentVolumeClaims)

Apply `03-pvcs.yaml`. Standalone PVCs for the component‑wrapper datastores (`postgresql`,
`documentdb`, `kafka`, `observability`); SeaweedFS uses `volumeClaimTemplates` embedded
in its StatefulSets (§7). Sizes match the chart defaults — adjust for production.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: falcone-postgresql-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${OCP_STORAGECLASS}
  resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: falcone-documentdb-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${OCP_STORAGECLASS}
  resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: falcone-kafka-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${OCP_STORAGECLASS}
  resources: { requests: { storage: 50Gi } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: falcone-observability-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${OCP_STORAGECLASS}
  resources: { requests: { storage: 20Gi } }
```

> The `postgresql-vector` (10Gi) and `openbao` (data 10Gi + audit 2Gi) PVCs are part of the
> core baseline and are included in their respective sections (§8).

---

## 7. Per‑component deployment (dependency order)

Each component below gives the full `ImageStream`/`BuildConfig` note (where applicable),
`Deployment`/`StatefulSet`, `Service`, and `Route` (external only). **Every image is a
`${HARBOR}/${HARBOR_PROJECT}/…` path resolved directly** (no ImageStream lookup; see
Appendix B for the optional trigger approach). All pods are `restricted-v2`‑compatible:
`runAsNonRoot: true` + seccomp `RuntimeDefault` at pod level (**no pinned `fsGroup`/uid**
— the SCC injects them), `allowPrivilegeEscalation: false` + `drop: [ALL]` per container.

### 7.1 PostgreSQL (shared relational store) — StatefulSet

The first datastore; Keycloak, the filer, Temporal and the control plane all depend on
it. Bitnami image; arbitrary‑uid friendly under `restricted-v2`.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-postgresql
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql, app.kubernetes.io/component: postgresql }
spec:
  serviceName: falcone-postgresql
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: postgresql }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql, app.kubernetes.io/component: postgresql }
    spec:
      serviceAccountName: falcone-postgresql
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: postgresql
          image: ${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: tcp-postgresql, containerPort: 5432, protocol: TCP }]
          env:
            - { name: POSTGRESQL_DATABASE, value: in_falcone }
          envFrom:
            - configMapRef: { name: falcone-postgresql-config }
            - secretRef: { name: in-falcone-postgresql }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { cpu: "1", memory: 2Gi }
          volumeMounts:
            - { name: data, mountPath: /bitnami/postgresql }
          readinessProbe:
            exec: { command: ["/bin/sh","-c","pg_isready -U $POSTGRESQL_USERNAME -d in_falcone -h 127.0.0.1"] }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: 5432 }
            initialDelaySeconds: 30
            periodSeconds: 15
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: falcone-postgresql-data }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-postgresql
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: postgresql }
  ports: [{ name: tcp-postgresql, port: 5432, targetPort: 5432, protocol: TCP }]
```

**Non‑obvious fields**
- `POSTGRESQL_DATABASE=in_falcone` creates the app DB; the app role + superuser come
  from `in-falcone-postgresql`. The Keycloak DB (`keycloak`) and `seaweedfs_filer` DB
  are created later by init containers/Jobs using the superuser password.
- No `fsGroup` is set — the Bitnami PostgreSQL image accepts the SCC‑injected fsGroup.
- The probes are added here (the chart relies on the Bitnami image defaults); they are
  generic and safe. **[VERIFY]** tune for your data volume.

### 7.2 DocumentDB engine (FerretDB backend) — StatefulSet

PostgreSQL 17 + DocumentDB extension. `wal_level=logical` is set via the **command line**
(the engine image does not include `conf.d`, so a ConfigMap GUC is ignored).

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-documentdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: documentdb, app.kubernetes.io/component: documentdb }
spec:
  serviceName: falcone-documentdb
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: documentdb }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: documentdb, app.kubernetes.io/component: documentdb }
    spec:
      serviceAccountName: falcone-documentdb
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: documentdb
          image: ${HARBOR}/${HARBOR_PROJECT}/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0
          imagePullPolicy: IfNotPresent
          args:
            - postgres
            - -c
            - shared_preload_libraries=pg_cron,pg_documentdb_core,pg_documentdb
            - -c
            - cron.database_name=postgres
            - -c
            - wal_level=logical
          ports: [{ name: tcp-documentdb, containerPort: 5432, protocol: TCP }]
          env:
            - { name: POSTGRES_DB, value: in_falcone }
            - { name: PGDATA, value: /var/lib/postgresql/data/pgdata }
          envFrom:
            - secretRef: { name: in-falcone-documentdb }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { cpu: "1", memory: 2Gi }
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
            - { name: documentdb-conf, mountPath: /etc/postgresql/conf.d/custom.conf, subPath: custom.conf, readOnly: true }
          readinessProbe:
            exec: { command: ["/bin/sh","-c","pg_isready -U $POSTGRES_USER -d postgres -h 127.0.0.1"] }
            initialDelaySeconds: 15
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: falcone-documentdb-data }
        - name: documentdb-conf
          configMap:
            name: in-falcone-documentdb-conf
            items: [{ key: custom.conf, path: custom.conf }]
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-documentdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: documentdb }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: documentdb }
  ports: [{ name: tcp-documentdb, port: 5432, targetPort: 5432, protocol: TCP }]
```

> The chart pins `runAsUser: 999`/`fsGroup: 999` for this image on vanilla Kubernetes,
> but the OpenShift overlay **nulls** them so `restricted-v2` injects a valid uid — this
> manifest follows the OpenShift path (no uid pin).

#### DocumentDB extension + logical‑replication init — Job

Run **after** the engine is Ready (creates the `documentdb` extension and the CDC
publication/role). Idempotent.

This Job runs `provision-logical-replication.sql` as the engine **superuser** (`PGUSER=postgres`),
which is the owner‑privileged role responsible for setting `REPLICA IDENTITY FULL` on every
`documentdb_data.documents_*` table — both the existing tables (step 4) and any created later (the
`falcone_documents_ri_full` event trigger, step 5). The live realtime CDC consumer role
`falcone_cdc_repl` is a non‑owner `LOGIN REPLICATION` role and does **not** own those tables (the
DocumentDB extension owns them as `documentdb_admin_role`). The realtime executor therefore does not
depend on owning the tables: on first subscribe it **skips** the `ALTER … REPLICA IDENTITY FULL`
for tables already FULL and **tolerates** a `42501 (must be owner)` for any not‑yet‑FULL table
rather than aborting the WAL consumer — that ALTER is this Job's responsibility. Realtime delivery
is scoped per **tenant and workspace** (two workspaces of one tenant sharing a database+collection
name do not cross‑receive change events).

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: falcone-documentdb-init
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: documentdb }
spec:
  backoffLimit: 5
  activeDeadlineSeconds: 600
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: documentdb }
    spec:
      restartPolicy: OnFailure
      automountServiceAccountToken: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: documentdb-init
          image: ${HARBOR}/${HARBOR_PROJECT}/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0
          imagePullPolicy: IfNotPresent
          command:
            - /bin/bash
            - -ec
            - |
              export PGHOST="${PGHOST}" PGPORT="${PGPORT}"
              export PGUSER="${POSTGRES_USER:-postgres}" PGPASSWORD="${POSTGRES_PASSWORD:-}"
              export PGDATABASE="${PGDATABASE:-postgres}"
              until pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}"; do
                echo "documentdb not ready; retry 2s"; sleep 2; done
              [ "$(psql -tAc "SELECT 1 FROM pg_available_extensions WHERE name='documentdb'")" = "1" ] || { echo "documentdb extension missing (wrong image?)"; exit 1; }
              psql -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS documentdb CASCADE"
              psql -v ON_ERROR_STOP=1 -v role="${REPL_ROLE}" -v pw="${REPL_PASSWORD}" -v pub="${REPL_PUB}" -f /sql/provision-logical-replication.sql
          env:
            - { name: PGHOST, value: falcone-documentdb }
            - { name: PGPORT, value: "5432" }
            - { name: PGDATABASE, value: postgres }
            - { name: HOME, value: /tmp }
            - { name: REPL_ROLE, value: falcone_cdc_repl }
            - { name: REPL_PUB, value: falcone_cdc_pub }
            - { name: REPL_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-documentdb-replication, key: password } } }
          envFrom:
            - secretRef: { name: in-falcone-documentdb }
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 250m, memory: 256Mi }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            - { name: provision-sql, mountPath: /sql/provision-logical-replication.sql, subPath: provision-logical-replication.sql, readOnly: true }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: tmp, emptyDir: {} }
        - name: provision-sql
          configMap:
            name: in-falcone-documentdb-conf
            items: [{ key: provision-logical-replication.sql, path: provision-logical-replication.sql }]
```

> **Why `PGDATABASE=postgres`:** the `documentdb` extension can only be created in the
> `postgres` database (pg_cron is bound to `cron.database_name='postgres'`). FerretDB
> connects to `postgres`; per‑tenant Mongo databases are logical namespaces inside it.

### 7.3 FerretDB gateway — Deployment

Stateless MongoDB‑wire proxy in front of `documentdb`. An init container waits for the
engine and ensures the `documentdb` extension (self‑sufficient startup).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-ferretdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: ferretdb, app.kubernetes.io/component: ferretdb }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: ferretdb }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: ferretdb, app.kubernetes.io/component: ferretdb }
    spec:
      serviceAccountName: falcone-ferretdb
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      initContainers:
        - name: wait-for-documentdb
          image: ${HARBOR}/${HARBOR_PROJECT}/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0
          imagePullPolicy: IfNotPresent
          command:
            - /bin/bash
            - -ec
            - |
              export PGUSER="${POSTGRES_USER:-postgres}" PGPASSWORD="${POSTGRES_PASSWORD:-}"
              until pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}"; do
                echo "engine not ready; retry 2s"; sleep 2; done
              [ "$(psql -h "${PGHOST}" -p "${PGPORT}" -d "${PGDATABASE}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='documentdb'")" = "1" ] || { echo "documentdb absent"; exit 1; }
              psql -h "${PGHOST}" -p "${PGPORT}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS documentdb CASCADE"
              until [ "$(psql -h "${PGHOST}" -p "${PGPORT}" -d "${PGDATABASE}" -tAc "SELECT 1 FROM information_schema.schemata WHERE schema_name='documentdb_api'")" = "1" ]; do
                echo "documentdb_api absent; retry 2s"; sleep 2; done
          env:
            - { name: PGHOST, value: falcone-documentdb }
            - { name: PGPORT, value: "5432" }
            - { name: PGDATABASE, value: postgres }
            - { name: HOME, value: /tmp }
          envFrom:
            - secretRef: { name: in-falcone-documentdb }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
      containers:
        - name: ferretdb
          image: ${HARBOR}/${HARBOR_PROJECT}/ferretdb/ferretdb:2.7.0
          imagePullPolicy: IfNotPresent
          ports:
            - { name: tcp-mongo, containerPort: 27017, protocol: TCP }
            - { name: http-debug, containerPort: 8088, protocol: TCP }
          env:
            - { name: FERRETDB_POSTGRESQL_URL, valueFrom: { secretKeyRef: { name: in-falcone-ferretdb, key: postgresql-url } } }
            - { name: FERRETDB_DEBUG_ADDR, value: ":8088" }
            - { name: FERRETDB_LISTEN_ADDR, value: ":27017" }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: "1", memory: 512Mi }
          livenessProbe:
            httpGet: { path: /debug/livez, port: 8088 }
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /debug/readyz, port: 8088 }
            initialDelaySeconds: 5
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-ferretdb
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: ferretdb }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: ferretdb }
  ports: [{ name: tcp-mongo, port: 27017, targetPort: 27017, protocol: TCP }]
```

**Non‑obvious fields**
- The FerretDB image is **distroless** (no shell) — readiness/liveness use kubelet
  `httpGet` on `/debug/readyz` and `/debug/livez` (no in‑container tooling needed).
- The init container "creates the extension here so the gateway is self‑sufficient" —
  this avoids a circular dependency with the post‑install `documentdb-init` Job under
  ordered installs. Both are idempotent.

### 7.4 Kafka (KRaft) — StatefulSet

> **[VERIFY] HA caveat.** The chart sets `replicas: 3` on a single component‑wrapper
> StatefulSet with **identical** env and one shared RWO PVC — that cannot form a proper
> KRaft quorum (no per‑broker node IDs / per‑pod storage). This guide deploys a
> **single‑node** KRaft broker (`replicas: 1`), which is reliable. For production HA,
> deploy Kafka with the **Strimzi** operator (if Operators are permitted) or hand‑author
> a per‑broker StatefulSet with `volumeClaimTemplates` and ordinal‑derived node IDs.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-kafka
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: kafka, app.kubernetes.io/component: kafka }
spec:
  serviceName: falcone-kafka
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: kafka }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: kafka, app.kubernetes.io/component: kafka }
    spec:
      serviceAccountName: falcone-kafka
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: kafka
          image: ${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/kafka:3.9.0
          imagePullPolicy: IfNotPresent
          ports:
            - { name: tcp-kafka, containerPort: 9092, protocol: TCP }
            - { name: controller, containerPort: 9093, protocol: TCP }
          envFrom:
            - configMapRef: { name: falcone-kafka-config }
            - secretRef: { name: in-falcone-kafka }
          resources:
            requests: { cpu: 300m, memory: 768Mi }
            limits:   { cpu: "1", memory: 2Gi }
          volumeMounts:
            - { name: data, mountPath: /bitnami/kafka }
          readinessProbe:
            tcpSocket: { port: 9092 }
            initialDelaySeconds: 20
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: falcone-kafka-data }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-kafka
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: kafka }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: kafka }
  ports: [{ name: tcp-kafka, port: 9092, targetPort: 9092, protocol: TCP }]
```

**Non‑obvious fields**
- KRaft config (node id, roles, listeners, controller quorum voters) is supplied via
  `falcone-kafka-config` (§5.2). `KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE=false` — topics
  are created explicitly by the platform.
- The controller quorum voter DNS `falcone-kafka-0.falcone-kafka:9093` resolves via the
  headless service name (`serviceName: falcone-kafka`).

### 7.5 SeaweedFS object storage (master → volume → filer → s3)

Four workloads. Apply in order; the s3 gateway depends on the filer, which depends on
the master and on PostgreSQL (filer metadata store). **OpenShift fix:** the upstream s3
template uses a `hostPath` logs volume (rejected by `restricted-v2`) — this manifest uses
`emptyDir` instead. Image is the digest‑pinned SeaweedFS 4.33.

#### Master — StatefulSet + Service

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-seaweedfs-master
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: master }
spec:
  serviceName: falcone-seaweedfs-master
  podManagementPolicy: Parallel
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: master }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: master }
    spec:
      serviceAccountName: falcone-seaweedfs
      enableServiceLinks: false
      terminationGracePeriodSeconds: 60
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: seaweedfs
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: POD_IP, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
            - { name: POD_NAME, valueFrom: { fieldRef: { fieldPath: metadata.name } } }
            - { name: SEAWEEDFS_FULLNAME, value: falcone-seaweedfs }
          command:
            - /bin/sh
            - -ec
            - |
              exec /usr/bin/weed -logdir=/logs -v=1 master \
                -port=9333 -mdir=/data -ip.bind=0.0.0.0 \
                -defaultReplication=000 -metricsPort=9327 -volumeSizeLimitMB=1000 \
                -electionTimeout=10s -heartbeatInterval=300ms \
                -ip=${POD_NAME}.falcone-seaweedfs-master.falcone \
                -peers=falcone-seaweedfs-master-0.falcone-seaweedfs-master.falcone:9333
          ports:
            - { containerPort: 9333, name: swfs-master }
            - { containerPort: 19333, name: swfs-master-grpc }
          volumeMounts:
            - { name: data-default, mountPath: /data }
            - { name: logs, mountPath: /logs/ }
            - { name: master-config, mountPath: /etc/seaweedfs/master.toml, subPath: master.toml, readOnly: true }
          readinessProbe:
            httpGet: { path: /cluster/status, port: 9333 }
            initialDelaySeconds: 10
            periodSeconds: 45
            failureThreshold: 100
          livenessProbe:
            httpGet: { path: /cluster/status, port: 9333 }
            initialDelaySeconds: 20
            periodSeconds: 30
            failureThreshold: 4
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: logs, emptyDir: {} }
        - name: master-config
          configMap: { name: falcone-seaweedfs-master-config }
  volumeClaimTemplates:
    - metadata: { name: data-default }
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ${OCP_STORAGECLASS}
        resources: { requests: { storage: 8Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-seaweedfs-master
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: master }
  annotations: { service.alpha.kubernetes.io/tolerate-unready-endpoints: "true" }
spec:
  clusterIP: None
  publishNotReadyAddresses: true
  selector: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: master }
  ports:
    - { name: swfs-master, port: 9333, targetPort: 9333 }
    - { name: swfs-master-grpc, port: 19333, targetPort: 19333 }
    - { name: metrics, port: 9327, targetPort: 9327 }
```

#### Volume — StatefulSet + Service

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-seaweedfs-volume
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: volume }
spec:
  serviceName: falcone-seaweedfs-volume
  podManagementPolicy: Parallel
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: volume }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: volume }
    spec:
      serviceAccountName: falcone-seaweedfs
      enableServiceLinks: false
      terminationGracePeriodSeconds: 150
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: seaweedfs
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: POD_NAME, valueFrom: { fieldRef: { fieldPath: metadata.name } } }
            - { name: SEAWEEDFS_FULLNAME, value: falcone-seaweedfs }
          command:
            - /bin/sh
            - -ec
            - |
              exec /usr/bin/weed -logdir=/logs -v=1 volume \
                -port=8080 -metricsPort=9327 -dir /data1 -max 0 -ip.bind=0.0.0.0 \
                -readMode=proxy -minFreeSpacePercent=1 -compactionMBps=50 \
                -ip=${POD_NAME}.falcone-seaweedfs-volume.falcone \
                -master=falcone-seaweedfs-master-0.falcone-seaweedfs-master.falcone:9333
          ports:
            - { containerPort: 8080, name: swfs-vol }
            - { containerPort: 18080, name: swfs-vol-grpc }
            - { containerPort: 9327, name: metrics }
          volumeMounts:
            - { name: data1, mountPath: /data1/ }
            - { name: logs, mountPath: /logs/ }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 15
            periodSeconds: 15
            failureThreshold: 100
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 20
            periodSeconds: 90
            failureThreshold: 4
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: "1", memory: 2Gi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: logs, emptyDir: {} }
  volumeClaimTemplates:
    - metadata: { name: data1 }
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ${OCP_STORAGECLASS}
        resources: { requests: { storage: 100Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-seaweedfs-volume
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: volume }
spec:
  clusterIP: None
  internalTrafficPolicy: Cluster
  selector: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: volume }
  ports:
    - { name: swfs-volume, port: 8080, targetPort: 8080 }
    - { name: swfs-volume-18080, port: 18080, targetPort: 18080 }
    - { name: metrics, port: 9327, targetPort: 9327 }
```

#### Filer — StatefulSet + 2 Services (filer + headless client)

The filer stores metadata in PostgreSQL (`seaweedfs_filer` DB). An init container
creates that DB using the shared‑PostgreSQL superuser credential.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falcone-seaweedfs-filer
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
spec:
  serviceName: falcone-seaweedfs-filer
  podManagementPolicy: Parallel
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
    spec:
      serviceAccountName: falcone-seaweedfs
      enableServiceLinks: false
      terminationGracePeriodSeconds: 60
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      initContainers:
        - name: wait-and-create-filer-db
          image: ${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0
          imagePullPolicy: IfNotPresent
          env:
            - { name: PGHOST, value: falcone-postgresql }
            - { name: PGPORT, value: "5432" }
            - { name: PGUSER, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_USERNAME, optional: true } } }
            - { name: PGPASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
            - { name: PGDATABASE, value: postgres }
          command:
            - /bin/sh
            - -ec
            - |
              : "${PGUSER:=postgres}"; export PGUSER
              until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER"; do echo "waiting for postgres"; sleep 2; done
              psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tc \
                "SELECT 1 FROM pg_database WHERE datname='seaweedfs_filer'" | grep -q 1 \
                || psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE seaweedfs_filer"
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      containers:
        - name: seaweedfs
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: POD_IP, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
            - { name: SEAWEEDFS_FULLNAME, value: falcone-seaweedfs }
            - { name: WEED_FILER_BUCKETS_FOLDER, value: "/buckets" }
            - { name: WEED_FILER_OPTIONS_RECURSIVE_DELETE, value: "false" }
            - { name: WEED_LEVELDB2_ENABLED, value: "false" }
            - { name: WEED_POSTGRES2_ENABLED, value: "true" }
            - { name: WEED_POSTGRES2_HOSTNAME, value: "falcone-postgresql" }
            - { name: WEED_POSTGRES2_PORT, value: "5432" }
            - { name: WEED_POSTGRES2_DATABASE, value: "seaweedfs_filer" }
            - { name: WEED_POSTGRES2_SCHEMA, value: "public" }
            - { name: WEED_POSTGRES2_SSLMODE, value: "disable" }
            - { name: WEED_POSTGRES2_CONNECTION_MAX_IDLE, value: "5" }
            - { name: WEED_POSTGRES2_CONNECTION_MAX_OPEN, value: "30" }
            - { name: WEED_POSTGRES2_USERNAME, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_USERNAME, optional: true } } }
            - { name: WEED_POSTGRES2_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
            - name: WEED_POSTGRES2_CREATETABLE
              value: |
                CREATE TABLE IF NOT EXISTS "%s" (
                  dirhash   BIGINT,
                  name      VARCHAR(65535),
                  directory VARCHAR(65535),
                  meta      bytea,
                  PRIMARY KEY (dirhash, name)
                );
          command:
            - /bin/sh
            - -ec
            - |
              exec /usr/bin/weed -logdir=/logs -v=1 filer \
                -port=8888 -metricsPort=9327 -dirListLimit=100000 -defaultReplicaPlacement=000 \
                -ip=${POD_IP} -ip.bind=0.0.0.0 \
                -master=falcone-seaweedfs-master-0.falcone-seaweedfs-master.falcone:9333
          ports:
            - { containerPort: 8888, name: swfs-filer }
            - { containerPort: 18888, name: swfs-filer-grpc }
            - { containerPort: 9327, name: metrics }
          volumeMounts:
            - { name: logs, mountPath: /logs/ }
            - { name: data-filer, mountPath: /data }
          readinessProbe:
            httpGet: { path: /, port: 8888 }
            initialDelaySeconds: 10
            periodSeconds: 15
            failureThreshold: 100
          livenessProbe:
            httpGet: { path: /, port: 8888 }
            initialDelaySeconds: 20
            periodSeconds: 30
            failureThreshold: 5
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: logs, emptyDir: {} }
  volumeClaimTemplates:
    - metadata: { name: data-filer }
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ${OCP_STORAGECLASS}
        resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-seaweedfs-filer
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
  annotations: { service.alpha.kubernetes.io/tolerate-unready-endpoints: "true" }
spec:
  clusterIP: None
  publishNotReadyAddresses: true
  selector: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
  ports:
    - { name: swfs-filer, port: 8888, targetPort: 8888 }
    - { name: swfs-filer-grpc, port: 18888, targetPort: 18888 }
    - { name: metrics, port: 9327, targetPort: 9327 }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-seaweedfs-filer-client
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer, monitoring: "true" }
spec:
  clusterIP: None
  selector: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: filer }
  ports:
    - { name: swfs-filer, port: 8888, targetPort: 8888 }
    - { name: swfs-filer-grpc, port: 18888, targetPort: 18888 }
    - { name: metrics, port: 9327, targetPort: 9327 }
```

#### S3 gateway — Deployment + Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-seaweedfs-s3
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: s3 }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: s3 }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: s3 }
    spec:
      serviceAccountName: falcone-seaweedfs
      enableServiceLinks: false
      terminationGracePeriodSeconds: 10
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: seaweedfs
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: SEAWEEDFS_FULLNAME, value: falcone-seaweedfs }
          command:
            - /bin/sh
            - -ec
            - |
              exec /usr/bin/weed -logdir=/logs -v=1 s3 \
                -ip.bind=0.0.0.0 -port=8333 -metricsPort 9327 \
                -filer=falcone-seaweedfs-filer-client.falcone:8888 -iam.readOnly=false
          ports:
            - { containerPort: 8333, name: swfs-s3 }
            - { containerPort: 9327, name: metrics }
          volumeMounts:
            - { name: logs, mountPath: /logs/ }
          readinessProbe:
            httpGet: { path: /status, port: 8333 }
            initialDelaySeconds: 15
            periodSeconds: 15
            failureThreshold: 100
          livenessProbe:
            httpGet: { path: /status, port: 8333 }
            initialDelaySeconds: 20
            periodSeconds: 60
            failureThreshold: 20
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: logs, emptyDir: {} }   # OpenShift fix: was hostPath in the upstream chart
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-seaweedfs-s3
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: s3 }
spec:
  type: ClusterIP
  internalTrafficPolicy: Cluster
  selector: { app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: s3 }
  ports:
    - { name: swfs-s3, port: 8333, targetPort: 8333 }
    - { name: metrics, port: 9327, targetPort: 9327 }
```

#### SeaweedFS admin‑seed + bucket Jobs

Run **after** the s3/filer are Ready. The seed writes the `falcone-s3-admin` identity
into the filer IAM; the bucket Job creates the platform system bucket.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: falcone-seaweedfs-admin-seed
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: seaweedfs-admin-seed }
spec:
  backoffLimit: 20
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: seaweedfs-admin-seed }
    spec:
      restartPolicy: Never
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: admin-seed
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: SW_MASTER, value: "falcone-seaweedfs-master.falcone:9333" }
            - { name: ADMIN_ACCESS_KEY, valueFrom: { secretKeyRef: { name: in-falcone-seaweedfs-s3-creds, key: s3AccessKey } } }
            - { name: ADMIN_SECRET_KEY, valueFrom: { secretKeyRef: { name: in-falcone-seaweedfs-s3-creds, key: s3SecretKey } } }
          command:
            - /bin/sh
            - -ec
            - |
              i=1
              while [ "$i" -le 60 ]; do
                out=$(printf 's3.configure -apply -user falcone-s3-admin -access_key %s -secret_key %s -actions Admin,Read,Write,List,Tagging\n' \
                        "$ADMIN_ACCESS_KEY" "$ADMIN_SECRET_KEY" | weed shell -master="$SW_MASTER" 2>&1) || true
                if printf '%s' "$out" | grep -q 'falcone-s3-admin'; then echo "OK: admin identity seeded"; exit 0; fi
                echo "attempt $i: not ready; retry 5s"; i=$((i+1)); sleep 5
              done
              echo "FAILED to seed admin identity" >&2; exit 1
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
---
apiVersion: batch/v1
kind: Job
metadata:
  name: falcone-seaweedfs-bucket
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: seaweedfs-bucket }
spec:
  backoffLimit: 10
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: seaweedfs, app.kubernetes.io/component: seaweedfs-bucket }
    spec:
      restartPolicy: Never
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: bucket
          image: ${HARBOR}/${HARBOR_PROJECT}/chrislusf/seaweedfs:4.33
          imagePullPolicy: IfNotPresent
          env:
            - { name: WEED_CLUSTER_SW_MASTER, value: "falcone-seaweedfs-master.falcone:9333" }
            - { name: WEED_CLUSTER_SW_FILER, value: "falcone-seaweedfs-filer-client.falcone:8888" }
          command:
            - /bin/sh
            - -ec
            - |
              for url in "http://$WEED_CLUSTER_SW_MASTER/cluster/status" "http://$WEED_CLUSTER_SW_FILER/"; do
                n=0; until wget -q --spider "$url"; do n=$((n+1)); [ $n -ge 60 ] && { echo "timeout $url"; exit 1; }; sleep 5; done
              done
              list=$(echo 's3.bucket.list' | weed shell) || { echo "list failed"; exit 1; }
              if echo "$list" | awk '{print $1}' | grep -Fxq "falcone-platform-system"; then
                echo "bucket exists"
              else
                echo 's3.bucket.create --name falcone-platform-system' | weed shell
              fi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
```

**Non‑obvious fields**
- Master/volume/filer peer DNS uses the headless StatefulSet form
  `…-0.<svc>.falcone:9333` — keep `serviceName` matching.
- The filer's `WEED_POSTGRES2_*` point at the shared PostgreSQL with a dedicated
  `seaweedfs_filer` database so filer table churn never collides with managed
  migrations. The `CREATE TABLE …` template is **required** at 4.33 (the default is
  malformed and crashes the filer on boot).
- The bucket Job's pod label `app.kubernetes.io/component: seaweedfs-bucket` plus the
  `batch.kubernetes.io/job-name: falcone-seaweedfs-bucket` (auto‑added) is what the
  SeaweedFS NetworkPolicy (§4.2) admits to reach master/filer.

### 7.6 Keycloak (identity provider) — Deployment + Service

Depends on PostgreSQL. An init container creates the `keycloak` database (owned by the
app role) using the superuser credential.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-keycloak
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: keycloak, app.kubernetes.io/component: keycloak }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: keycloak }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: keycloak, app.kubernetes.io/component: keycloak }
    spec:
      serviceAccountName: falcone-keycloak
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      initContainers:
        - name: keycloak-db-init
          image: ${HARBOR}/${HARBOR_PROJECT}/bitnamilegacy/postgresql:17.2.0
          imagePullPolicy: IfNotPresent
          command:
            - /bin/sh
            - -ec
            - |
              until pg_isready -h "${PGHOST}" -p "${PGPORT}" -U postgres; do echo "waiting for postgresql"; sleep 2; done
              export PGPASSWORD="${POSTGRESQL_POSTGRES_PASSWORD}"
              PSQL="psql -h ${PGHOST} -p ${PGPORT} -U postgres -d postgres -tAc"
              if [ "$(${PSQL} "SELECT 1 FROM pg_database WHERE datname='${KEYCLOAK_DB_NAME}'")" != "1" ]; then
                psql -h "${PGHOST}" -p "${PGPORT}" -U postgres -d postgres \
                  -c "CREATE DATABASE \"${KEYCLOAK_DB_NAME}\" OWNER \"${POSTGRESQL_USERNAME}\"" \
                  || [ "$(${PSQL} "SELECT 1 FROM pg_database WHERE datname='${KEYCLOAK_DB_NAME}'")" = "1" ]
              fi
              psql -h "${PGHOST}" -p "${PGPORT}" -U postgres -d "${KEYCLOAK_DB_NAME}" -v ON_ERROR_STOP=1 \
                -c "ALTER SCHEMA public OWNER TO \"${POSTGRESQL_USERNAME}\""
          env:
            - { name: PGHOST, value: falcone-postgresql }
            - { name: PGPORT, value: "5432" }
            - { name: KEYCLOAK_DB_NAME, value: keycloak }
            - { name: HOME, value: /tmp }
          envFrom:
            - secretRef: { name: in-falcone-postgresql }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
      containers:
        - name: keycloak
          image: ${HARBOR}/${HARBOR_PROJECT}/keycloak/keycloak:26.1.0
          imagePullPolicy: IfNotPresent
          command: ["/opt/keycloak/bin/kc.sh"]
          args: ["start", "--http-enabled=true", "--hostname-strict=false"]
          ports: [{ name: http, containerPort: 8080, protocol: TCP }]
          env:
            - { name: KC_PROXY_HEADERS, value: xforwarded }
            - { name: KC_HEALTH_ENABLED, value: "true" }
            - { name: KC_DB, value: postgres }
            # [VERIFY] Keycloak serves under /auth (matches the gateway oidcIssuerUrl and
            # the identity Route path). KC 26 default base path is "/", so this MUST be set
            # for the /auth/realms/... URLs to resolve. Keep ALL KC URLs consistent with it.
            - { name: KC_HTTP_RELATIVE_PATH, value: /auth }
            - { name: KC_HOSTNAME, value: "https://iam.${APPS_DOMAIN}/auth" }
            - { name: KC_DB_USERNAME, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_USERNAME } } }
            - { name: KC_DB_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
            - { name: JAVA_OPTS_KC_HEAP, value: "-Xms512m -Xmx1280m" }
          envFrom:
            - configMapRef: { name: falcone-keycloak-config }
            - configMapRef: { name: in-falcone-keycloak-db }
            - secretRef: { name: in-falcone-identity-client }
          resources:
            requests: { cpu: 250m, memory: 1Gi }
            limits:   { cpu: "1", memory: 2Gi }
          startupProbe:
            httpGet: { path: /auth/health/started, port: 9000 }
            failureThreshold: 60
            periodSeconds: 5
          readinessProbe:
            httpGet: { path: /auth/health/ready, port: 9000 }
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-keycloak
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: keycloak }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: keycloak }
  ports: [{ name: http, port: 8080, targetPort: 8080, protocol: TCP }]
```

> **[VERIFY] Health port.** Keycloak 26 serves health on the **management interface
> (port 9000)** when `KC_HEALTH_ENABLED=true` — the probes above target `9000` at the
> `/auth` relative path. If your image exposes health on `8080`, adjust the probe port.

### 7.7 Control‑plane (Product/Management API) — Deployment + Service

The env below is the production set from the OpenShift overlay (the base chart leaves
most of it to ESO/OpenBao). `automountServiceAccountToken: true` because the control‑plane
calls the Kubernetes API to create Knative Services for functions.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-control-plane
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane, app.kubernetes.io/component: control-plane }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: control-plane }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane, app.kubernetes.io/component: control-plane }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: /metrics
    spec:
      serviceAccountName: falcone-control-plane
      automountServiceAccountToken: true
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: control-plane
          image: ${HARBOR}/${HARBOR_PROJECT}/in-falcone-control-plane:0.3.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 8080, protocol: TCP }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: ROUTE_MAP_FILE, value: /app/route-map.runtime.json }
            - { name: PGHOST, value: falcone-postgresql }
            - { name: PGPORT, value: "5432" }
            - { name: PGUSER, value: falcone }
            - { name: PGDATABASE, value: in_falcone }
            - { name: PGPASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
            - { name: KEYCLOAK_JWKS_URL, value: "http://falcone-keycloak:8080/auth/realms/in-falcone-platform/protocol/openid-connect/certs" }
            - { name: KEYCLOAK_BASE_URL, value: "http://falcone-keycloak:8080/auth" }
            - { name: KEYCLOAK_ADMIN_USERNAME, valueFrom: { secretKeyRef: { name: in-falcone-keycloak-admin, key: username } } }
            - { name: KEYCLOAK_ADMIN_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-keycloak-admin, key: password } } }
            - { name: STORAGE_S3_ENDPOINT, value: "http://falcone-seaweedfs-s3:8333" }
            - { name: STORAGE_S3_ACCESS_KEY, valueFrom: { secretKeyRef: { name: in-falcone-storage, key: s3_access_key } } }
            - { name: STORAGE_S3_SECRET_KEY, valueFrom: { secretKeyRef: { name: in-falcone-storage, key: s3_secret_key } } }
            - { name: MONGO_HOST, value: "falcone-ferretdb:27017" }
            - { name: MONGO_BACKEND, value: ferretdb }
            - { name: MONGO_USER, valueFrom: { secretKeyRef: { name: in-falcone-documentdb, key: POSTGRES_USER } } }
            - { name: MONGO_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-documentdb, key: POSTGRES_PASSWORD } } }
            - { name: KAFKA_BROKERS, value: "falcone-kafka:9092" }
            - { name: FN_RUNTIME_IMAGE, value: "${HARBOR}/${HARBOR_PROJECT}/in-falcone-fn-runtime:0.3.0" }
          envFrom:
            - configMapRef: { name: falcone-control-plane-config }
            - configMapRef: { name: in-falcone-control-plane-config }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits:   { cpu: "1", memory: 1Gi }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-control-plane
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: control-plane }
  ports: [{ name: http, port: 8080, targetPort: 8080, protocol: TCP }]
```

> **[VERIFY] readiness path.** `/healthz` is used by the executor; confirm the
> control‑plane exposes the same (the chart sets no probe on it). If not, use a
> `tcpSocket: 8080` probe.

### 7.8 Control‑plane executor (data plane) — Deployment + Service

The executor runs adapter plans against the real backends. The chart renders only
`GATEWAY_SHARED_SECRET`; this guide adds the backend connection env it needs to function
(same variable names as the control‑plane — both build from `apps/control-plane-executor`).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-control-plane-executor
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane-executor, app.kubernetes.io/component: control-plane-executor }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: control-plane-executor }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane-executor, app.kubernetes.io/component: control-plane-executor }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: /metrics
    spec:
      serviceAccountName: falcone-control-plane-executor
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: control-plane-executor
          image: ${HARBOR}/${HARBOR_PROJECT}/in-falcone-control-plane-executor:0.3.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: GATEWAY_SHARED_SECRET, valueFrom: { secretKeyRef: { name: in-falcone-gateway-shared-secret, key: secret } } }
            # [VERIFY] Backend connectivity — the executor mediates real backends. These
            # mirror the control-plane env; confirm the exact names your executor build reads.
            - { name: CONTROL_PLANE_UPSTREAM, value: "http://falcone-control-plane:8080" }
            - { name: PGHOST, value: falcone-postgresql }
            - { name: PGPORT, value: "5432" }
            - { name: PGUSER, value: falcone }
            - { name: PGDATABASE, value: in_falcone }
            - { name: PGPASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
            - { name: MONGO_HOST, value: "falcone-ferretdb:27017" }
            - { name: MONGO_BACKEND, value: ferretdb }
            - { name: MONGO_USER, valueFrom: { secretKeyRef: { name: in-falcone-documentdb, key: POSTGRES_USER } } }
            - { name: MONGO_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-documentdb, key: POSTGRES_PASSWORD } } }
            - { name: STORAGE_S3_ENDPOINT, value: "http://falcone-seaweedfs-s3:8333" }
            - { name: STORAGE_S3_ACCESS_KEY, valueFrom: { secretKeyRef: { name: in-falcone-storage, key: s3_access_key } } }
            - { name: STORAGE_S3_SECRET_KEY, valueFrom: { secretKeyRef: { name: in-falcone-storage, key: s3_secret_key } } }
            - { name: KAFKA_BROKERS, value: "falcone-kafka:9092" }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 3
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-control-plane-executor
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: control-plane-executor }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: control-plane-executor }
  ports: [{ name: http, port: 8080, targetPort: 8080, protocol: TCP }]
```

### 7.9 APISIX (API gateway) — Deployment + 2 Services

The gateway is the single external entry point. In this guide it runs with the **Admin
API enabled** (`APISIX_STAND_ALONE=false`, §5.2) so the bootstrap Job can push routes via
port 9180. The `falcone-in-falcone-apisix-admin` Service exposes the admin port to the
bootstrap Job only (no Route).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-apisix
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix, app.kubernetes.io/component: apisix }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: apisix }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix, app.kubernetes.io/component: apisix }
    spec:
      serviceAccountName: falcone-apisix
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: apisix
          image: ${HARBOR}/${HARBOR_PROJECT}/apache/apisix:3.10.0-debian
          imagePullPolicy: IfNotPresent
          ports:
            - { name: http, containerPort: 9080, protocol: TCP }
            - { name: admin, containerPort: 9180, protocol: TCP }
          env:
            - { name: APISIX_STAND_ALONE, valueFrom: { configMapKeyRef: { name: falcone-apisix-config, key: APISIX_STAND_ALONE } } }
            - { name: GATEWAY_SHARED_SECRET, valueFrom: { secretKeyRef: { name: in-falcone-gateway-shared-secret, key: secret } } }
            # [VERIFY] If your APISIX consumes the admin key from env, wire it here:
            # - { name: APISIX_ADMIN_KEY, valueFrom: { secretKeyRef: { name: in-falcone-apisix-admin, key: admin-key } } }
          envFrom:
            - configMapRef: { name: in-falcone-gateway-config }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits:   { cpu: "1", memory: 1Gi }
          readinessProbe:
            tcpSocket: { port: 9080 }
            initialDelaySeconds: 10
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: false
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-apisix
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: apisix }
  ports: [{ name: http, port: 9080, targetPort: 9080, protocol: TCP }]
---
# Admin API Service — used by the bootstrap Job to push routes (not exposed via Route).
apiVersion: v1
kind: Service
metadata:
  name: falcone-in-falcone-apisix-admin
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: apisix, app.kubernetes.io/component: bootstrap }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: apisix }
  ports: [{ name: admin, port: 9180, targetPort: 9180, protocol: TCP }]
```

> **[VERIFY] Standalone vs Admin‑API.** The chart's `APISIX_STAND_ALONE` default is
> `"true"` but ships an admin Service + a bootstrap Job that uses the Admin API — these
> are mutually exclusive. This guide chooses **Admin‑API mode** (`false`) so route
> bootstrap works. *Alternative:* set it `"true"`, mount a static `apisix.yaml` ConfigMap
> with your routes at `/usr/local/apisix/conf/apisix.yaml`, and **skip** the route portion
> of the bootstrap Job. Pick one and keep §5.2 consistent.

### 7.10 Web console — Deployment + Service

Node static server serving the built SPA; same-origin `/v1` proxies to the gateway via the
`GATEWAY_UPSTREAM` env baked into the image (default `falcone-apisix:9080`).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-web-console
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: web-console, app.kubernetes.io/component: web-console }
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: web-console }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: web-console, app.kubernetes.io/component: web-console }
    spec:
      serviceAccountName: falcone-web-console
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: web-console
          image: ${HARBOR}/${HARBOR_PROJECT}/in-falcone-web-console:0.3.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 3000, protocol: TCP }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: PUBLIC_BASE_PATH, value: / }
            - { name: GATEWAY_UPSTREAM, value: "falcone-apisix:9080" }
          envFrom:
            - configMapRef: { name: falcone-web-console-config }
            - configMapRef: { name: in-falcone-web-console-config }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          readinessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 5
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-web-console
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: web-console }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: web-console }
  ports: [{ name: http, port: 3000, targetPort: 3000, protocol: TCP }]
```

> **[VERIFY] web-console port under `restricted-v2`.** The release image serves on
> `3000` (non-privileged) with the repository static server and does not require nginx cache or
> pid-file write paths.

### 7.11 Observability — Prometheus — Deployment + Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-observability
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: observability, app.kubernetes.io/component: observability }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: observability }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: observability, app.kubernetes.io/component: observability }
    spec:
      serviceAccountName: falcone-observability
      automountServiceAccountToken: true   # pod service-discovery reads pods via the API
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: observability
          image: ${HARBOR}/${HARBOR_PROJECT}/prom/prometheus@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62
          imagePullPolicy: IfNotPresent
          args:
            - --config.file=/etc/prometheus/prometheus.yml
            - --storage.tsdb.path=/prometheus
            - --storage.tsdb.retention.time=15d
            - --web.enable-lifecycle
          ports: [{ name: http, containerPort: 9090, protocol: TCP }]
          envFrom:
            - configMapRef: { name: falcone-observability-config }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits:   { cpu: "1", memory: 1Gi }
          volumeMounts:
            - { name: data, mountPath: /prometheus }
            - { name: prometheus-config, mountPath: /etc/prometheus, readOnly: true }
          readinessProbe:
            httpGet: { path: /-/ready, port: 9090 }
            initialDelaySeconds: 10
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: falcone-observability-data } }
        - { name: prometheus-config, configMap: { name: falcone-prometheus-config } }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-observability
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: observability }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: observability }
  ports: [{ name: http, port: 9090, targetPort: 9090, protocol: TCP }]
```

### 7.12 Grafana — Deployment + Service

> The upstream chart pins `runAsUser: 472`/`fsGroup: 472`. That is **outside** the
> `restricted-v2` range and would be rejected — removed here so the SCC injects the uid.
> Grafana writes only to `/var/lib/grafana`; with anonymous viewer access it needs no
> persistence for dashboards (provisioned from ConfigMaps).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: falcone-grafana
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: grafana, app.kubernetes.io/component: grafana }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: grafana }
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: grafana, app.kubernetes.io/component: grafana }
    spec:
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: grafana
          image: ${HARBOR}/${HARBOR_PROJECT}/grafana/grafana:11.4.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 3000 }]
          env:
            - { name: GF_AUTH_ANONYMOUS_ENABLED, value: "true" }
            - { name: GF_AUTH_ANONYMOUS_ORG_ROLE, value: "Viewer" }
            - { name: GF_SECURITY_ALLOW_EMBEDDING, value: "true" }
            - { name: GF_USERS_DEFAULT_THEME, value: "light" }
          readinessProbe:
            httpGet: { path: /api/health, port: http }
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          volumeMounts:
            - { name: provisioning-datasources, mountPath: /etc/grafana/provisioning/datasources }
            - { name: provisioning-dashboards, mountPath: /etc/grafana/provisioning/dashboards }
            - { name: dashboards, mountPath: /var/lib/grafana/dashboards }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            runAsNonRoot: true
      volumes:
        - name: provisioning-datasources
          configMap: { name: falcone-grafana-provisioning, items: [{ key: datasource.yaml, path: datasource.yaml }] }
        - name: provisioning-dashboards
          configMap: { name: falcone-grafana-provisioning, items: [{ key: dashboards.yaml, path: dashboards.yaml }] }
        - name: dashboards
          configMap: { name: falcone-grafana-dashboards }
---
apiVersion: v1
kind: Service
metadata:
  name: falcone-grafana
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: grafana }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: grafana }
  ports: [{ name: http, port: 3000, targetPort: http }]
```

### 7.13 Bootstrap Job (Keycloak realm + APISIX routes)

Runs **last**, after Keycloak and APISIX are Ready. It imports the realm and pushes the
gateway routes. Uses the `alpine/k8s` helper image + the two large ConfigMaps from §5.2.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: falcone-bootstrap
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: bootstrap }
spec:
  backoffLimit: 6
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: bootstrap }
    spec:
      restartPolicy: OnFailure
      serviceAccountName: falcone-bootstrap
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      initContainers:
        - name: wait-for-keycloak
          image: ${HARBOR}/${HARBOR_PROJECT}/alpine/k8s:1.32.2
          imagePullPolicy: IfNotPresent
          command:
            - /bin/bash
            - -ec
            - |
              KC="http://falcone-keycloak.falcone.svc.cluster.local:8080/auth"
              DEADLINE=$(( $(date +%s) + 600 ))
              until [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$KC/realms/master")" = "200" ]; do
                [ "$(date +%s)" -ge "$DEADLINE" ] && { echo "keycloak not ready"; exit 1; }
                echo "waiting for keycloak"; sleep 5
              done
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
      containers:
        - name: bootstrap
          image: ${HARBOR}/${HARBOR_PROJECT}/alpine/k8s:1.32.2
          imagePullPolicy: IfNotPresent
          command: ["/bin/bash", "/bootstrap/script/bootstrap.sh"]
          env:
            - { name: RELEASE_NAME, value: falcone }
            - { name: RELEASE_NAMESPACE, value: falcone }
            - { name: BOOTSTRAP_APISIX_ADMIN_KEY, valueFrom: { secretKeyRef: { name: in-falcone-apisix-admin, key: admin-key } } }
            - { name: BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-keycloak-admin, key: password } } }
            - { name: BOOTSTRAP_KEYCLOAK_ADMIN_USERNAME, valueFrom: { secretKeyRef: { name: in-falcone-keycloak-admin, key: username } } }
            - { name: BOOTSTRAP_SUPERADMIN_PASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-superadmin, key: password } } }
          volumeMounts:
            - { name: script, mountPath: /bootstrap/script, readOnly: true }
            - { name: payload, mountPath: /bootstrap/payload, readOnly: true }
            - { name: tmp, mountPath: /tmp }
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
            runAsNonRoot: true
      volumes:
        - { name: script, configMap: { name: falcone-in-falcone-bootstrap-script, defaultMode: 0755 } }
        - { name: payload, configMap: { name: falcone-in-falcone-bootstrap-payload } }
        - { name: tmp, emptyDir: {} }
```

> **[VERIFY] bootstrap.sh DNS + KC path.** The bootstrap script (large ConfigMap) builds
> internal URLs from `RELEASE_NAME`/`RELEASE_NAMESPACE`. Confirm it targets
> `falcone-keycloak.falcone.svc:8080/auth` and `falcone-in-falcone-apisix-admin.falcone.svc:9180`
> for this namespace and the `/auth` Keycloak relative path. If the script hard‑codes a
> different namespace/path, regenerate it with matching values before applying.

### 7.14 Routes (external exposure)

Four Routes expose the platform. Replace `${APPS_DOMAIN}`. `edge` TLS terminates at the
router; switch to `reencrypt` if you also serve TLS inside the pods. The upstream chart
adds a stray `kubernetes.io/ingress.class: nginx` annotation — **removed** here (it is an
Ingress concept, ignored/harmful on Routes).

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: falcone-api
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
  annotations: { haproxy.router.openshift.io/timeout: 30s }
spec:
  host: api.${APPS_DOMAIN}
  path: /control-plane
  to: { kind: Service, name: falcone-apisix }
  port: { targetPort: http }
  tls: { termination: edge, insecureEdgeTerminationPolicy: Redirect }
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: falcone-console
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
  annotations: { haproxy.router.openshift.io/timeout: 30s }
spec:
  host: console.${APPS_DOMAIN}
  path: /
  to: { kind: Service, name: falcone-web-console }
  port: { targetPort: http }
  tls: { termination: edge, insecureEdgeTerminationPolicy: Redirect }
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: falcone-identity
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
  annotations: { haproxy.router.openshift.io/timeout: 30s }
spec:
  host: iam.${APPS_DOMAIN}
  path: /auth
  to: { kind: Service, name: falcone-keycloak }
  port: { targetPort: http }
  tls: { termination: edge, insecureEdgeTerminationPolicy: Redirect }
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: falcone-realtime
  namespace: falcone
  labels: { app.kubernetes.io/part-of: falcone }
  annotations: { haproxy.router.openshift.io/timeout: 3600s }   # long-lived SSE/realtime
spec:
  host: realtime.${APPS_DOMAIN}
  path: /realtime
  to: { kind: Service, name: falcone-apisix }
  port: { targetPort: http }
  tls: { termination: edge, insecureEdgeTerminationPolicy: Redirect }
```

> **Non‑obvious:** `api` and `realtime` both route to the **APISIX** Service (the gateway
> fans out internally); `console` → web‑console; `identity` → Keycloak. The realtime
> Route uses a long HAProxy timeout for SSE streams. The host names must match the
> `*Hostname` values in `in-falcone-gateway-config` (§5.2) and Keycloak `KC_HOSTNAME`.

---

## 8. Core service manifests

These services are part of the baseline. Each is self-contained and slots in after the
core data plane is healthy in this plain-manifest install.

### 8.1 OpenBao (secrets manager)

> The chart deploys OpenBao in a separate `secret-store` namespace and uses a cert‑manager
> `Certificate` for TLS. In an air‑gap cluster without cert‑manager, this guide deploys
> OpenBao **in `falcone`** with a **manually‑generated self‑signed TLS Secret**, and
> disables `mlock` (the `IPC_LOCK` capability is dropped under `restricted-v2`). OpenBao is the
> open-source Vault fork; the CLI is `bao` and the KV‑v2 REST surface is Vault-compatible.

**1) Generate the TLS Secret** (off‑cluster, then apply):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=openbao.falcone.svc.cluster.local" \
  -addext "subjectAltName=DNS:openbao,DNS:openbao.falcone,DNS:openbao.falcone.svc,DNS:openbao.falcone.svc.cluster.local,DNS:openbao-internal.falcone.svc.cluster.local"
cp tls.crt ca.crt   # self-signed: the cert is its own CA
oc -n falcone create secret generic openbao-server-tls \
  --from-file=tls.crt=tls.crt --from-file=tls.key=tls.key --from-file=ca.crt=ca.crt \
  --dry-run=client -o yaml | oc apply -f -
```

**2) Config, policies, RBAC, PVCs, StatefulSet, Services, init Job:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: openbao-config, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
data:
  openbao.hcl: |
    storage "file" { path = "/openbao/data" }
    listener "tcp" {
      address       = "0.0.0.0:8200"
      tls_disable   = 0
      tls_cert_file = "/openbao/tls/tls.crt"
      tls_key_file  = "/openbao/tls/tls.key"
    }
    disable_mlock     = true
    ui                = true
    default_lease_ttl = "24h"
    max_lease_ttl     = "768h"
    api_addr     = "https://openbao.falcone.svc.cluster.local:8200"
    cluster_addr = "https://$(HOSTNAME).openbao-internal.falcone.svc.cluster.local:8201"
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: openbao, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
---
# CLUSTER-ADMIN: OpenBao's Kubernetes auth needs tokenreviews + SA token creation.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: falcone-openbao-kubernetes-auth }
rules:
  - apiGroups: [""]
    resources: ["serviceaccounts", "serviceaccounts/token", "nodes"]
    verbs: ["get", "create"]
  - apiGroups: ["authentication.k8s.io"]
    resources: ["tokenreviews"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: falcone-openbao-kubernetes-auth }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: falcone-openbao-kubernetes-auth }
subjects:
  - { kind: ServiceAccount, name: openbao, namespace: falcone }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: openbao-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec: { accessModes: ["ReadWriteOnce"], storageClassName: ${OCP_STORAGECLASS}, resources: { requests: { storage: 10Gi } } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: openbao-audit, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec: { accessModes: ["ReadWriteOnce"], storageClassName: ${OCP_STORAGECLASS}, resources: { requests: { storage: 2Gi } } }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: openbao, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: openbao } }
spec:
  serviceName: openbao-internal
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: openbao } }
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: openbao } }
    spec:
      serviceAccountName: openbao
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: openbao
          image: ${HARBOR}/${HARBOR_PROJECT}/openbao/openbao:2.3.1
          imagePullPolicy: IfNotPresent
          args: ["server", "-config=/openbao/config/openbao.hcl"]
          env:
            - { name: BAO_ADDR, value: https://openbao.falcone.svc.cluster.local:8200 }
            - { name: BAO_API_ADDR, value: https://openbao.falcone.svc.cluster.local:8200 }
            - { name: BAO_CACERT, value: /openbao/tls/ca.crt }
          ports:
            - { containerPort: 8200, name: http }
            - { containerPort: 8201, name: cluster }
          readinessProbe:
            httpGet: { scheme: HTTPS, path: "/v1/sys/health?standbyok=true&sealedcode=204&uninitcode=204", port: 8200 }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet: { scheme: HTTPS, path: "/v1/sys/health?standbyok=true", port: 8200 }
            initialDelaySeconds: 30
            periodSeconds: 15
          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: data, mountPath: /openbao/data }
            - { name: audit, mountPath: /openbao/audit }
            - { name: config, mountPath: /openbao/config, readOnly: true }
            - { name: tls, mountPath: /openbao/tls, readOnly: true }
      volumes:
        - { name: config, configMap: { name: openbao-config } }
        - { name: tls, secret: { secretName: openbao-server-tls } }
        - { name: data, persistentVolumeClaim: { claimName: openbao-data } }
        - { name: audit, persistentVolumeClaim: { claimName: openbao-audit } }
---
apiVersion: v1
kind: Service
metadata: { name: openbao, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: openbao } }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: openbao }
  ports: [{ name: http, port: 8200, targetPort: 8200 }, { name: cluster, port: 8201, targetPort: 8201 }]
---
apiVersion: v1
kind: Service
metadata: { name: openbao-internal, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: openbao } }
spec:
  clusterIP: None
  selector: { app.kubernetes.io/name: openbao }
  ports: [{ name: http, port: 8200, targetPort: 8200 }, { name: cluster, port: 8201, targetPort: 8201 }]
```

> **[VERIFY] OpenBao init.** The chart ships an `openbao-init` Job that runs
> `bao operator init`/`unseal`, enables Kubernetes auth + KV‑v2, writes policies, and
> seeds placeholder secrets. Reproduce it adapted to this namespace: set
> `bound_service_account_namespaces='falcone'` (the chart uses
> `postgresql,documentdb,kafka,apisix,keycloak,eso-system` — those don't exist here).
> **Storing the unseal keys/root token securely is an operator responsibility** — do not
> leave them in a Job log. For production prefer auto‑unseal. The
> `secret-audit-handler` sidecar (node:20‑alpine tailing the file audit log → Kafka) is
> **omitted** here; to enable it, bundle `packages/secret-audit-handler/src` into a
> ConfigMap `secret-audit-handler-bundle` and add the sidecar from the chart render.

### 8.2 Temporal (flows engine) + workflow‑worker

Temporal persists in the shared PostgreSQL (no Elasticsearch — SQL visibility). The four
server roles run as separate Deployments; a schema Job creates the DBs/schema first, a
bootstrap Job registers the `falcone-flows` namespace + search attributes, and
`workflow-worker` runs the DSL interpreter.

> **[VERIFY] Temporal PostgreSQL role.** Temporal connects as role `temporal`/`temporal`
> (chart‑hardcoded). Create it once before the schema Job:
>
> ```bash
> oc -n falcone exec sts/falcone-postgresql -- bash -lc \
>   'PGPASSWORD=$POSTGRESQL_POSTGRES_PASSWORD psql -U postgres -c "CREATE ROLE temporal LOGIN PASSWORD '\''temporal'\'' CREATEDB;"'
> ```
>
> For production, change the password and update `falcone-temporal-config` + the Job env.

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: falcone-temporal-config, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: temporal } }
data:
  docker.yaml: |
    log: { stdout: true, level: info }
    persistence:
      numHistoryShards: 512
      defaultStore: default
      visibilityStore: visibility
      datastores:
        default:
          sql: { pluginName: "postgres12", databaseName: "temporal", connectAddr: "falcone-postgresql:5432", connectProtocol: "tcp", user: "temporal", password: "temporal", maxConns: 20, maxIdleConns: 20, maxConnLifetime: "1h" }
        visibility:
          sql: { pluginName: "postgres12", databaseName: "temporal_visibility", connectAddr: "falcone-postgresql:5432", connectProtocol: "tcp", user: "temporal", password: "temporal", maxConns: 10, maxIdleConns: 10, maxConnLifetime: "1h" }
    global:
      membership: { maxJoinDuration: 30s, broadcastAddress: "__BROADCAST_ADDRESS__" }
      pprof: { port: 0 }
      metrics: { prometheus: { framework: "tally", listenAddress: "0.0.0.0:9090" } }
    services:
      frontend: { rpc: { grpcPort: 7233, membershipPort: 6933, bindOnIP: "__BIND_IP__" } }
      history:  { rpc: { grpcPort: 7234, membershipPort: 6934, bindOnIP: "__BIND_IP__" } }
      matching: { rpc: { grpcPort: 7235, membershipPort: 6935, bindOnIP: "__BIND_IP__" } }
      worker:   { rpc: { grpcPort: 7239, membershipPort: 6939, bindOnIP: "__BIND_IP__" } }
    clusterMetadata:
      enableGlobalNamespace: false
      failoverVersionIncrement: 10
      masterClusterName: "active"
      currentClusterName: "active"
      clusterInformation:
        active: { enabled: true, initialFailoverVersion: 1, rpcName: "frontend", rpcAddress: "falcone-temporal-frontend:7233" }
    dcRedirectionPolicy: { policy: "noop" }
    services.frontend.service.publicClient.hostPort: "falcone-temporal-frontend:7233"
    dynamicConfigClient: { filepath: "/tmp/temporal/dynamicconfig/docker.yaml", pollInterval: "60s" }
  dynamic_config.yaml: |
    system.forceSearchAttributesCacheRefreshOnRead:
      - value: true
        constraints: {}
    limit.maxIDLength:
      - value: 255
        constraints: {}
---
# Schema Job (run FIRST): creates temporal + temporal_visibility DBs and schema.
apiVersion: batch/v1
kind: Job
metadata: { name: falcone-temporal-schema, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: temporal } }
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 600
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: temporal } }
    spec:
      restartPolicy: OnFailure
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: temporal-sql-tool
          image: ${HARBOR}/${HARBOR_PROJECT}/temporalio/admin-tools:1.31.1
          imagePullPolicy: IfNotPresent
          command:
            - /bin/sh
            - -ec
            - |
              SQL="temporal-sql-tool --ep ${SQL_HOST} --port ${SQL_PORT} --user ${SQL_USER} --password ${SQL_PASSWORD} --plugin ${SQL_PLUGIN}"
              i=0; while [ "$i" -lt 60 ]; do ${SQL} --database postgres create-database >/dev/null 2>&1 && break; i=$((i+1)); echo "waiting for postgres ($i/60)"; sleep 5; done
              ${SQL} --database "${SQL_DATABASE}" create-database || true
              ${SQL} --database "${SQL_DATABASE}" setup-schema -v 0.0
              ${SQL} --database "${SQL_DATABASE}" update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned
              ${SQL} --database "${SQL_VISIBILITY_DATABASE}" create-database || true
              ${SQL} --database "${SQL_VISIBILITY_DATABASE}" setup-schema -v 0.0
              ${SQL} --database "${SQL_VISIBILITY_DATABASE}" update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned
          env:
            - { name: SQL_PLUGIN, value: postgres12 }
            - { name: SQL_HOST, value: falcone-postgresql }
            - { name: SQL_PORT, value: "5432" }
            - { name: SQL_USER, value: temporal }
            - { name: SQL_PASSWORD, value: temporal }
            - { name: SQL_DATABASE, value: temporal }
            - { name: SQL_VISIBILITY_DATABASE, value: temporal_visibility }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, runAsNonRoot: true }
```

The four server Deployments share a start wrapper that substitutes the pod IP into a
writable copy of the config (the plain server image does not template config from env).
**frontend:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: falcone-temporal-frontend, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: temporal-frontend, in-falcone.io/component: temporal, temporal.io/role: frontend } }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: temporal-frontend, temporal.io/role: frontend } }
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: temporal-frontend, in-falcone.io/component: temporal, temporal.io/role: frontend } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: temporal-frontend
          image: ${HARBOR}/${HARBOR_PROJECT}/temporalio/server:1.31.1
          imagePullPolicy: IfNotPresent
          command:
            - /bin/sh
            - -ec
            - |
              mkdir -p /tmp/temporal/config /tmp/temporal/dynamicconfig
              sed -e "s/__BROADCAST_ADDRESS__/${POD_IP}/g" -e "s/__BIND_IP__/${POD_IP}/g" \
                /etc/temporal/config-src/docker.yaml > /tmp/temporal/config/docker.yaml
              cp /etc/temporal/config-src/dynamic_config.yaml /tmp/temporal/dynamicconfig/docker.yaml
              exec /etc/temporal/entrypoint.sh
          ports: [{ name: grpc, containerPort: 7233 }, { name: membership, containerPort: 6933 }]
          env:
            - { name: SERVICES, value: frontend }
            - { name: TEMPORAL_ROOT, value: /tmp/temporal }
            - { name: TEMPORAL_CONFIG_DIR, value: config }
            - { name: TEMPORAL_ENVIRONMENT, value: docker }
            - { name: POD_IP, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
            - { name: BIND_ON_IP, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
            - { name: TEMPORAL_BROADCAST_ADDRESS, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
            - { name: TEMPORAL_ADDRESS, value: "falcone-temporal-frontend:7233" }
            - { name: DB, value: postgres12 }
            - { name: DB_PORT, value: "5432" }
            - { name: POSTGRES_SEEDS, value: falcone-postgresql }
            - { name: POSTGRES_USER, value: temporal }
            - { name: POSTGRES_PWD, value: temporal }
            - { name: DBNAME, value: temporal }
            - { name: VISIBILITY_DBNAME, value: temporal_visibility }
            - { name: ENABLE_ES, value: "false" }
            - { name: SQL_TLS_ENABLED, value: "false" }
          volumeMounts:
            - { name: config-src, mountPath: /etc/temporal/config-src, readOnly: true }
            - { name: runtime, mountPath: /tmp/temporal }
          resources: { requests: { cpu: 100m, memory: 256Mi }, limits: { cpu: 500m, memory: 512Mi } }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, runAsNonRoot: true }
      volumes:
        - { name: config-src, configMap: { name: falcone-temporal-config } }
        - { name: runtime, emptyDir: {} }
```

**history / matching / worker** are identical to `frontend` except for the fields in this
table — copy the `frontend` Deployment and change them (the `worker` role additionally
needs an init container that waits for the frontend to be SERVING):

| Field | history | matching | worker |
|---|---|---|---|
| `metadata.name` | `falcone-temporal-history` | `falcone-temporal-matching` | `falcone-temporal-worker` |
| labels `name`/`role` | `temporal-history`/`history` | `temporal-matching`/`matching` | `temporal-worker`/`worker` |
| `env SERVICES` | `history` | `matching` | `worker` |
| `ports` grpc / membership | `7234` / `6934` | `7235` / `6935` | `7239` / `6939` |
| memory limit | `1Gi` (request 512Mi) | `512Mi` | `512Mi` |
| extra | — | — | init container `wait-for-frontend` (image `…/temporalio/admin-tools:1.31.1`) running `temporal operator cluster health --address falcone-temporal-frontend:7233 --namespace temporal-system` in a retry loop |

**web (UI)** + the five Services + the bootstrap Job + the worker:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: falcone-temporal-web, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: temporal-web, in-falcone.io/component: temporal, temporal.io/role: web } }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: temporal-web, temporal.io/role: web } }
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: temporal-web, in-falcone.io/component: temporal, temporal.io/role: web } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: temporal-web
          image: ${HARBOR}/${HARBOR_PROJECT}/temporalio/ui:2.51.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - { name: TEMPORAL_ADDRESS, value: "falcone-temporal-frontend:7233" }
            - { name: TEMPORAL_UI_PORT, value: "8080" }
            - { name: TEMPORAL_CSRF_COOKIE_INSECURE, value: "true" }
          resources: { requests: { cpu: 50m, memory: 128Mi }, limits: { cpu: 250m, memory: 256Mi } }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, runAsNonRoot: true }
---
# Five ClusterIP Services (one per role). UI is internal-only (port-forward).
apiVersion: v1
kind: Service
metadata: { name: falcone-temporal-frontend, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, temporal.io/role: frontend } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: temporal-frontend, temporal.io/role: frontend }, ports: [{ name: grpc, port: 7233, targetPort: 7233 }, { name: membership, port: 6933, targetPort: 6933 }] }
---
apiVersion: v1
kind: Service
metadata: { name: falcone-temporal-history, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, temporal.io/role: history } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: temporal-history, temporal.io/role: history }, ports: [{ name: grpc, port: 7234, targetPort: 7234 }, { name: membership, port: 6934, targetPort: 6934 }] }
---
apiVersion: v1
kind: Service
metadata: { name: falcone-temporal-matching, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, temporal.io/role: matching } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: temporal-matching, temporal.io/role: matching }, ports: [{ name: grpc, port: 7235, targetPort: 7235 }, { name: membership, port: 6935, targetPort: 6935 }] }
---
apiVersion: v1
kind: Service
metadata: { name: falcone-temporal-worker, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, temporal.io/role: worker } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: temporal-worker, temporal.io/role: worker }, ports: [{ name: grpc, port: 7239, targetPort: 7239 }, { name: membership, port: 6939, targetPort: 6939 }] }
---
apiVersion: v1
kind: Service
metadata: { name: falcone-temporal-web, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, temporal.io/role: web } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: temporal-web, temporal.io/role: web }, ports: [{ name: http, port: 8080, targetPort: 8080 }] }
---
# Bootstrap Job (run AFTER the frontend is healthy): namespace + search attributes.
apiVersion: batch/v1
kind: Job
metadata: { name: falcone-temporal-bootstrap, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: temporal } }
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 600
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/component: temporal } }
    spec:
      restartPolicy: OnFailure
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: temporal-bootstrap
          image: ${HARBOR}/${HARBOR_PROJECT}/temporalio/admin-tools:1.31.1
          imagePullPolicy: IfNotPresent
          command:
            - /bin/sh
            - -ec
            - |
              i=0; while [ "$i" -lt 60 ]; do temporal operator cluster health --address "${FLOW_FRONTEND_ADDR}" --namespace temporal-system >/dev/null 2>&1 && break; i=$((i+1)); echo "waiting frontend ($i/60)"; sleep 5; done
              temporal operator namespace describe --address "${FLOW_FRONTEND_ADDR}" --namespace "${FLOW_NAMESPACE}" >/dev/null 2>&1 || \
                temporal operator namespace create --address "${FLOW_FRONTEND_ADDR}" --namespace "${FLOW_NAMESPACE}" --retention "${FLOW_RETENTION}"
              for sa in tenantId workspaceId flowId flowVersion triggerType; do
                temporal operator search-attribute create --address "${FLOW_FRONTEND_ADDR}" --namespace "${FLOW_NAMESPACE}" --name "$sa" --type Keyword >/dev/null 2>&1 || true
              done
          env:
            - { name: FLOW_FRONTEND_ADDR, value: "falcone-temporal-frontend:7233" }
            - { name: FLOW_NAMESPACE, value: falcone-flows }
            - { name: FLOW_RETENTION, value: "7d" }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, runAsNonRoot: true }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: falcone-workflow-worker, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: workflow-worker, app.kubernetes.io/component: flows-worker } }
spec:
  replicas: 2
  selector: { matchLabels: { app.kubernetes.io/name: workflow-worker } }
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: workflow-worker, app.kubernetes.io/component: flows-worker } }
    spec:
      serviceAccountName: falcone-control-plane    # reuse; or create a dedicated SA
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: workflow-worker
          image: ${HARBOR}/${HARBOR_PROJECT}/in-falcone-workflow-worker:0.3.0
          imagePullPolicy: IfNotPresent
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - { name: TEMPORAL_ADDRESS, value: "falcone-temporal-frontend:7233" }
            - { name: TEMPORAL_NAMESPACE, value: falcone-flows }
            - { name: TEMPORAL_TASK_QUEUE, value: flows-main }
            - { name: WORKER_HEALTH_PORT, value: "8080" }
            # [VERIFY] add PG*/MONGO*/STORAGE_S3* if the worker's DB activities connect directly.
          resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { cpu: 500m, memory: 512Mi } }
          livenessProbe: { httpGet: { path: /livez, port: 8080 }, initialDelaySeconds: 10, periodSeconds: 15 }
          readinessProbe: { httpGet: { path: /readyz, port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true, runAsNonRoot: true }
      terminationGracePeriodSeconds: 30
---
apiVersion: v1
kind: Service
metadata: { name: falcone-workflow-worker, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: workflow-worker } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: workflow-worker }, ports: [{ name: http, port: 8080, targetPort: 8080 }] }
```

> Add a NetworkPolicy `falcone-temporal-frontend` (ingress 7233 from
> `app.kubernetes.io/component in (flows-api, flows-worker)` and
> `in-falcone.io/component: temporal`) to match the chart's posture. The Temporal Web UI
> has no Route — reach it via `oc -n falcone port-forward svc/falcone-temporal-web 8080:8080`.

### 8.3 pgvector PostgreSQL (vector search) — StatefulSet

Dedicated `pgvector` Postgres for dedicated‑DB tenants enabling KNN search.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: falcone-postgresql-vector-data, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec: { accessModes: ["ReadWriteOnce"], storageClassName: ${OCP_STORAGECLASS}, resources: { requests: { storage: 10Gi } } }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: falcone-postgresql-vector, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql-vector } }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: falcone-postgresql-vector, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql-vector, app.kubernetes.io/component: postgresql-vector } }
spec:
  serviceName: falcone-postgresql-vector
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: postgresql-vector } }
  template:
    metadata: { labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql-vector, app.kubernetes.io/component: postgresql-vector } }
    spec:
      serviceAccountName: falcone-postgresql-vector
      automountServiceAccountToken: false
      enableServiceLinks: false
      imagePullSecrets: [{ name: harbor-pull }]
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: postgresql-vector
          image: ${HARBOR}/${HARBOR_PROJECT}/pgvector/pgvector:pg17
          imagePullPolicy: IfNotPresent
          ports: [{ name: tcp-pgvector, containerPort: 5432, protocol: TCP }]
          env:
            - { name: POSTGRES_DB, value: in_falcone_vector }
            - { name: PGDATA, value: /var/lib/postgresql/data/pgdata }
          envFrom: [{ secretRef: { name: in-falcone-postgresql-vector } }]
          resources: { requests: { cpu: 250m, memory: 512Mi }, limits: { cpu: "1", memory: 2Gi } }
          volumeMounts: [{ name: data, mountPath: /var/lib/postgresql/data }]
          readinessProbe: { exec: { command: ["/bin/sh","-c","pg_isready -U $POSTGRES_USER -d in_falcone_vector -h 127.0.0.1"] }, initialDelaySeconds: 10, periodSeconds: 10 }
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, runAsNonRoot: true }
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: falcone-postgresql-vector-data } }
---
apiVersion: v1
kind: Service
metadata: { name: falcone-postgresql-vector, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone, app.kubernetes.io/name: postgresql-vector } }
spec: { type: ClusterIP, selector: { app.kubernetes.io/name: postgresql-vector }, ports: [{ name: tcp-pgvector, port: 5432, targetPort: 5432 }] }
```

Create its credential Secret first:
`oc -n falcone create secret generic in-falcone-postgresql-vector --from-literal=POSTGRES_USER=falcone --from-literal=POSTGRES_PASSWORD=$(openssl rand -hex 24)`.

### 8.4 MCP runtime RBAC + NetworkPolicy

Hosted MCP servers run as **Knative Services** created at runtime by the control‑plane
(needs OpenShift Serverless). Only the Role/RoleBinding + NetworkPolicy are static:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: falcone-mcp-runtime, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
rules:
  - { apiGroups: ["serving.knative.dev"], resources: ["services"], verbs: ["create","get","list","watch","update","patch","delete"] }
  - { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["create","get","list","watch","update","patch","delete"] }
  - { apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles","rolebindings"], verbs: ["create","get","list","watch","update","patch","delete"] }
  - { apiGroups: [""], resources: ["pods","pods/log"], verbs: ["get","list"] }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: falcone-mcp-runtime, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: falcone-mcp-runtime }
subjects: [{ kind: ServiceAccount, name: falcone-control-plane-executor, namespace: falcone }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: falcone-mcp-server-internal-only, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  podSelector: { matchLabels: { in-falcone.io/component: mcp-server } }
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: knative-serving } }
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kourier-system } }
  egress:
    - to: [{ namespaceSelector: {} }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: falcone } } }]
```

---

## 9. Ordered install runbook

Suggested file layout (one manifest set per file). Apply top‑to‑bottom; wait at each
checkpoint. All commands assume `oc project falcone` is current.

```text
manifests/
  00-namespace-rbac.yaml      # §4 (cluster-admin for the SeaweedFS ClusterRole)
  01-networkpolicies.yaml     # §4.2
  02-configmaps.yaml          # §5.2 (+ falcone-large-configmaps.yaml from the chart)
  03-secrets via oc commands  # §5.1 (not a file)
  04-pvcs.yaml                # §6
  10-postgresql.yaml          # §7.1
  11-documentdb.yaml          # §7.2 (StatefulSet) + documentdb-init Job
  12-kafka.yaml               # §7.4
  13-seaweedfs.yaml           # §7.5 (master/volume/filer/s3) + seed/bucket Jobs
  20-keycloak.yaml            # §7.6
  21-ferretdb.yaml            # §7.3
  30-control-plane.yaml       # §7.7
  31-executor.yaml            # §7.8
  32-apisix.yaml              # §7.9
  33-web-console.yaml         # §7.10
  34-observability.yaml       # §7.11 + §7.12 grafana
  40-bootstrap.yaml           # §7.13
  50-routes.yaml              # §7.14
  90-core-*.yaml              # §8 core service supplements
```

```bash
# 0. Pre-reqs: Project + pull secret + SA linking (§3.3, §4, §4.1)
oc apply -f manifests/00-namespace-rbac.yaml
oc project falcone
# (run the §3.3 secret-create + secrets link commands here)
oc apply -f manifests/01-networkpolicies.yaml

# 1. Config + storage (§5.2, §6). Includes the 3 large generated ConfigMaps.
oc apply -f manifests/02-configmaps.yaml
oc apply -f falcone-large-configmaps.yaml      # realm / bootstrap script / gateway policy
# (run the §5.1 oc-create-secret commands here)
oc apply -f manifests/04-pvcs.yaml

# 2. Data plane — PostgreSQL first, then the rest in parallel.
oc apply -f manifests/10-postgresql.yaml
oc rollout status statefulset/falcone-postgresql --timeout=300s        # CHECKPOINT
oc apply -f manifests/11-documentdb.yaml
oc apply -f manifests/12-kafka.yaml
oc apply -f manifests/13-seaweedfs.yaml
oc rollout status statefulset/falcone-documentdb --timeout=300s        # CHECKPOINT
oc rollout status statefulset/falcone-kafka --timeout=300s             # CHECKPOINT
oc rollout status statefulset/falcone-seaweedfs-master --timeout=300s
oc rollout status statefulset/falcone-seaweedfs-volume --timeout=300s
oc rollout status statefulset/falcone-seaweedfs-filer  --timeout=300s
oc rollout status deployment/falcone-seaweedfs-s3 --timeout=300s       # CHECKPOINT
# Wait for the init/seed Jobs:
oc wait --for=condition=complete job/falcone-documentdb-init --timeout=300s
oc wait --for=condition=complete job/falcone-seaweedfs-admin-seed --timeout=300s
oc wait --for=condition=complete job/falcone-seaweedfs-bucket --timeout=300s   # CHECKPOINT

# 3. Auth + app tier
oc apply -f manifests/20-keycloak.yaml
oc rollout status deployment/falcone-keycloak --timeout=600s           # CHECKPOINT (slow)
oc apply -f manifests/21-ferretdb.yaml
oc apply -f manifests/30-control-plane.yaml
oc apply -f manifests/31-executor.yaml
oc apply -f manifests/32-apisix.yaml
oc apply -f manifests/33-web-console.yaml
oc rollout status deployment/falcone-ferretdb --timeout=300s
oc rollout status deployment/falcone-control-plane --timeout=300s
oc rollout status deployment/falcone-control-plane-executor --timeout=300s
oc rollout status deployment/falcone-apisix --timeout=300s
oc rollout status deployment/falcone-web-console --timeout=300s        # CHECKPOINT

# 4. Bootstrap (realm + gateway routes), observability, Routes
oc apply -f manifests/40-bootstrap.yaml
oc wait --for=condition=complete job/falcone-bootstrap --timeout=900s  # CHECKPOINT
oc apply -f manifests/34-observability.yaml
oc apply -f manifests/50-routes.yaml

# 5. Core service manifests (§8) — apply as part of the baseline.
# Temporal: schema Job -> servers -> bootstrap Job -> worker
oc apply -f manifests/90-core-temporal.yaml
oc wait --for=condition=complete job/falcone-temporal-schema --timeout=600s
oc rollout status deployment/falcone-temporal-frontend --timeout=300s
oc wait --for=condition=complete job/falcone-temporal-bootstrap --timeout=600s
```

> **Why this order:** PostgreSQL must be Ready before Keycloak (DB init), DocumentDB (CDC
> consumers), the SeaweedFS filer (metadata DB) and Temporal (schema). The bootstrap Job
> needs Keycloak + APISIX serving. The init/seed Jobs are gated explicitly with
> `oc wait` so dependents never start against an unprepared backend.

---

## 10. Verification

```bash
# All pods Ready, no CrashLoopBackOff / ImagePullBackOff:
oc get pods -n falcone -o wide
oc get pods -n falcone --field-selector=status.phase!=Running

# Rollouts and Jobs:
oc get deploy,statefulset -n falcone
oc get jobs -n falcone

# Datastore smoke tests:
oc -n falcone exec sts/falcone-postgresql -- bash -lc 'pg_isready -U $POSTGRESQL_USERNAME -d in_falcone'
oc -n falcone exec deploy/falcone-ferretdb -- /bin/sh -c 'wget -qO- http://localhost:8088/debug/readyz' || true
oc -n falcone exec deploy/falcone-seaweedfs-s3 -- /bin/sh -c 'wget -qO- http://localhost:8333/status'

# Keycloak realm present (via the identity Route):
curl -fsS https://iam.${APPS_DOMAIN}/auth/realms/in-falcone-platform/.well-known/openid-configuration | head

# Gateway routes pushed (control-plane reachable through APISIX):
curl -fsS https://api.${APPS_DOMAIN}/control-plane/healthz || \
curl -fsS https://api.${APPS_DOMAIN}/control-plane/openapi | head

# Web console:
curl -fsSI https://console.${APPS_DOMAIN}/ | head

# Prometheus scraping:
oc -n falcone port-forward svc/falcone-observability 9090:9090 &
curl -fsS http://localhost:9090/api/v1/targets | head
```

**What "healthy" looks like:** every Deployment shows `AVAILABLE = desired`, every
StatefulSet `READY = n/n`, the four init/seed Jobs and the bootstrap Job show
`COMPLETIONS 1/1`, the four Routes resolve over HTTPS, and the OIDC discovery document
returns. Reach the platform at `https://console.${APPS_DOMAIN}` (UI),
`https://api.${APPS_DOMAIN}/control-plane` (API), `https://iam.${APPS_DOMAIN}/auth` (IdP).

---

## 11. Troubleshooting (air‑gap / OpenShift pitfalls)

| Symptom | Likely cause | Fix |
|---|---|---|
| `ImagePullBackOff` / `ErrImagePull` | Image not mirrored into Harbor, wrong path, or node doesn't trust Harbor CA | Confirm the exact tag exists in Harbor (`skopeo inspect docker://${HARBOR}/${HARBOR_PROJECT}/<img>`); verify node‑level registry trust (§2 [VERIFY]); confirm `harbor-pull` is linked to the SA. |
| `unauthorized` pulling | Robot account lacks pull on the project, or pull secret wrong | Recreate `harbor-pull` (§3.3); `oc -n falcone get sa default -o yaml` should list it under `imagePullSecrets`. |
| Pod `CreateContainerConfigError` referencing a Secret/ConfigMap | Referenced Secret/ConfigMap not created or wrong key | The §5.1 table lists every required Secret + keys; `oc -n falcone get secret,cm`. |
| Pod rejected: `unable to validate against any security context constraint` / `runAsUser: Invalid value` | A pinned uid/fsGroup outside the namespace range under `restricted-v2` | Remove the pin (this guide already nulls them for grafana/openbao/documentdb/pgvector); or bind a dedicated SCC to that SA only. |
| `hostPath` volume denied | restricted SCC forbids hostPath (upstream SeaweedFS s3 default) | Already fixed here (s3 logs use `emptyDir`); ensure you used the §7.5 s3 manifest, not the upstream one. |
| PVC stuck `Pending` | StorageClass missing/!dynamic, or no RWO capacity | `oc get pvc -n falcone`; set `${OCP_STORAGECLASS}` to a valid dynamic RWO class; check quota. |
| Build base image not found (BuildConfig) | `FROM` points at a public registry / base not mirrored | Mirror `node:22-alpine` and `node:22-slim` to Harbor and set the BuildConfig `strategy.dockerStrategy.from` to the Harbor path (Appendix B). |
| `documentdb-init` fails `documentdb absent from pg_available_extensions` | Wrong/mismatched DocumentDB image mirrored | Mirror the **digest‑pinned** `ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`. |
| FerretDB CrashLoop / `logical decoding requires wal_level >= logical` | DocumentDB started without `wal_level=logical` | Ensure the `args` (command‑line `-c wal_level=logical`) in §7.2 are present (a `conf.d` GUC is ignored by this image). |
| Keycloak 404 on `/auth/...` or OIDC issuer mismatch | `KC_HTTP_RELATIVE_PATH`/`KC_HOSTNAME` inconsistent with the Route + gateway config | Keep `/auth` consistent across Keycloak env, `in-falcone-gateway-config`, and the identity Route (§7.6 [VERIFY]). |
| Kafka CrashLoop / quorum errors | Multi‑broker on one StatefulSet with shared config/PVC | Use the single‑node config in §7.4, or deploy Strimzi for HA. |
| Bootstrap Job times out at `wait-for-keycloak` | Keycloak not serving, or wrong internal URL/path | Confirm `falcone-keycloak` Ready and the script targets `…:8080/auth`; check the bootstrap script's namespace/DNS (§7.13 [VERIFY]). |
| SeaweedFS install hangs at the bucket Job | NetworkPolicy dropped the Job's traffic to master/filer | Ensure the §4.2 SeaweedFS policy admits `batch.kubernetes.io/job-name: falcone-seaweedfs-bucket`. |
| Functions/MCP fail to deploy | OpenShift Serverless (Knative) absent | Install the Serverless Operator + `KnativeServing`, then retry the runtime-created workload. |
| ImageStream trigger didn't roll out a Deployment | Deployments don't auto‑follow ImageStreams | Use direct Harbor image refs (default here), or add the `image.openshift.io/triggers` annotation (Appendix B). |
| OpenBao pod CrashLoop `mlock` / `cannot allocate memory` | `IPC_LOCK` dropped under restricted SCC | `disable_mlock = true` is set in `openbao.hcl` (§8.1) — confirm it's applied. |

---

## Appendix A — Image reference self‑scan (Harbor‑only confirmation)

**Confirmed:** every `image:` field in every manifest in §4–§8 is a
`${HARBOR}/${HARBOR_PROJECT}/…` path. There are **no** references to `docker.io`,
`quay.io`, `gcr.io`, `ghcr.io`, or any unprefixed public image in the applied manifests.
Public registries appear **only** inside the §3.2 `skopeo copy` *source* arguments (by
design — that is the mirror step) and in the §3.1 table's "Original image" column.

Changes made versus the raw chart render to achieve a clean air‑gap/OpenShift install
(each is called out inline above too):

1. **Registry rewrite** — every `docker.io/…`, `quay.io/…`, `ghcr.io/…` image (incl.
   init containers, the OpenBao `node:20-alpine` sidecar, Temporal admin‑tools, bitnami
   kubectl bootstrap, the `bitnamilegacy/postgresql` filer‑init image) rewritten to
   `${HARBOR}/${HARBOR_PROJECT}/…`.
2. **SeaweedFS s3 `hostPath` → `emptyDir`** for logs (restricted SCC forbids hostPath).
3. **Removed pinned uid/fsGroup** on grafana (472), openbao (100/1000), documentdb (999),
   pgvector (999) so `restricted-v2` injects them from the namespace range.
4. **Falcone-built images** must come from your Harbor project; do not deploy old
   placeholders or unverified public first-party runtime tags.
5. **SeaweedFS** mutable tag `4.33` → recommend the digest pin in §3.1.
6. **Removed** the stray `kubernetes.io/ingress.class: nginx` annotation from Routes.
7. **Namespace consolidation** — OpenBao (`secret-store`), SeaweedFS (`default`), ESO
   (`eso-system`) all moved into `falcone`; cross‑namespace DNS/policies adjusted.
8. **OpenBao** `disable_mlock = true` (IPC_LOCK dropped) + manual self‑signed TLS Secret
   (no cert‑manager dependency).
9. **APISIX** `APISIX_STAND_ALONE=false` to make the route bootstrap operative.

> To machine‑verify your assembled files before applying:
>
> ```bash
> grep -REn 'image:\s*"?(docker\.io|quay\.io|gcr\.io|ghcr\.io|registry\.k8s\.io)/' manifests/ \
>   && echo "FOUND PUBLIC REFS — fix before applying" || echo "OK: Harbor-only"
> grep -REn 'image:\s*"?[a-z0-9._-]+/[a-z0-9._/-]+:' manifests/ | grep -v '\${HARBOR}' \
>   && echo "FOUND non-Harbor image" || echo "OK: all images use \${HARBOR}"
> ```

---

## Appendix B — Optional: ImageStream + BuildConfig for the build‑from‑source images

The core guide resolves images **directly** to Harbor (no ImageStream). If you prefer
OpenShift‑native, ImageStream‑driven rollouts for Falcone's own images, use this pattern.
**Air‑gap caveat:** the BuildConfig `git` source needs the repo reachable — clone
`github.com/gntik-ai/falcone` is typically blocked, so either (a) point `source.git.uri`
at an **internal Git mirror**, or (b) skip BuildConfig entirely and push pre‑built images
(the recommended path).

```yaml
# ImageStream that holds the built tag inside the cluster registry.
apiVersion: image.openshift.io/v1
kind: ImageStream
metadata: { name: in-falcone-control-plane, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec: { lookupPolicy: { local: true } }
---
# Docker-strategy build. The FROM base MUST be a Harbor path (the build runs air-gapped).
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata: { name: in-falcone-control-plane, namespace: falcone, labels: { app.kubernetes.io/part-of: falcone } }
spec:
  source:
    type: Git
    git: { uri: "https://git.internal.example.com/mirror/falcone.git", ref: main }   # internal mirror
    # contextDir: "."  # build from repo root (the Dockerfile COPYs sibling service dirs)
  strategy:
    type: Docker
    dockerStrategy:
      dockerfilePath: apps/control-plane-executor/Dockerfile
      from:
        kind: DockerImage
        name: ${HARBOR}/${HARBOR_PROJECT}/library/node:22-alpine   # base from Harbor
  output:
    to: { kind: ImageStreamTag, name: "in-falcone-control-plane:0.3.0" }
  # Builds pull the base via the 'builder' SA — ensure harbor-pull is linked (§3.3).
```

To make a `Deployment` follow that ImageStream tag (since Deployments don't do it
natively), add this annotation and set the container image to a placeholder the trigger
resolves:

```yaml
# On the Deployment metadata:
metadata:
  annotations:
    image.openshift.io/triggers: |
      [{"from":{"kind":"ImageStreamTag","name":"in-falcone-control-plane:0.3.0","namespace":"falcone"},
        "fieldPath":"spec.template.spec.containers[?(@.name==\"control-plane\")].image"}]
```

Repeat the ImageStream/BuildConfig per build‑from‑source image
(`in-falcone-control-plane-executor`, `in-falcone-web-console`,
`in-falcone-workflow-worker`, `in-falcone-fn-runtime`, `in-falcone-mcp-runtime`) with the right
`dockerfilePath` and Harbor base (`node:22-alpine`, `node:22-slim`).

---

## Assumptions & gaps an operator must resolve before a production install

1. **Node‑level Harbor trust** (CA + any `ImageDigestMirrorSet`) is a cluster‑admin
   prerequisite — pull secrets alone don't establish registry TLS trust. *(§2)*
2. **OpenShift Serverless (Knative)** must be present for the **functions** and **MCP**
   capabilities. This is the only OLM/Operator prerequisite for the all-core OpenShift
   installation. *(§1.1)*
3. **The three large generated ConfigMaps** (`realm.json`, `bootstrap.sh`,
   `gateway-policy.json`) are not inlined — generate them from the chart on a connected
   host and apply (§5.2). The realm export is **required** for bootstrap.
4. **Build‑from‑source images** (`control-plane`, `control-plane-executor`,
   `web-console`, `workflow-worker`, `fn-runtime`, `mcp-runtime`) must be pre‑built and
   pushed to Harbor (recommended) or built via BuildConfig against an internal Git mirror.
   *(§3.1, App. B)*
5. **Production digest pins:** SeaweedFS should use the recorded digest rather than the
   mutable `:4.33` tag; mirror the six first-party `0.3.0` images and OpenBao `2.3.1`
   by digest for production. *(§3.1)*
6. **Executor backend env** (`PG*/MONGO*/STORAGE_S3*/KAFKA_BROKERS`,
   `CONTROL_PLANE_UPSTREAM`) and the **control‑plane `/healthz`** probe path are marked
   `[VERIFY]` — confirm against your build before go‑live. *(§7.7, §7.8)*
7. **Keycloak `/auth` consistency** across `KC_HTTP_RELATIVE_PATH`, `KC_HOSTNAME`, the
   gateway config, the JWKS URLs and the identity Route. *(§7.6)*
8. **APISIX standalone‑vs‑Admin‑API** decision (this guide uses Admin‑API). *(§7.9)*
9. **Kafka HA** — single‑node baseline here; use Strimzi or a per‑broker StatefulSet for
   production HA. *(§7.4)*
10. **Temporal PostgreSQL role** (`temporal`) must be created before the schema Job, and
    the hard‑coded `temporal/temporal` password changed for production. *(§8.2)*
11. **Secrets** are created with `oc create secret` (placeholders/random) — integrate
    with ESO/OpenBao for production rotation; never commit real values. *(§5.1)*
12. **Intra‑namespace NetworkPolicy posture** for `postgresql`/`kafka`/`documentdb` is
    left to the operator (templates provided). *(§4.2)*

---

*End of guide.*
