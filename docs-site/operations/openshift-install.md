# OpenShift Install

This guide installs Falcone on OpenShift with Helm. It covers the public-image path and the
restricted-network Harbor overlay.

The chart's OpenShift source of truth is:

```text
../falcone-charts/charts/in-falcone/values/platform-openshift.yaml
../falcone-charts/deploy/openshift/values-openshift.yaml
deploy/OPENSHIFT-HARBOR-REVIEW.md
```

The review document says the chart is OpenShift/Harbor-ready at render level. Remaining gates are
clean-cluster evidence, exact Harbor mirror validation, and digest pinning from the manifests that
are actually installed.

## OpenShift-specific behavior

| Area | Kubernetes | OpenShift |
| --- | --- | --- |
| Public exposure | `Ingress` from `values/platform-kubernetes.yaml` | `Route` from `values/platform-openshift.yaml` |
| Security profile | `restricted` | `restricted-v2` |
| Runtime-created functions/MCP | Knative Serving | OpenShift Serverless Operator plus a `KnativeServing` custom resource |
| Private registry overlay | `values/airgap.yaml` | `deploy/openshift/values-openshift.yaml` plus mirrored images and pull secret |

OpenShift installs must not reuse `../falcone-charts/deploy/kind/values-kind.yaml`. That file is a
kind/local-registry overlay.

## Prerequisites

- `oc` logged in to the target cluster.
- Helm 3.
- A target Project name.
- A default or chosen CSI storage class.
- OpenShift Serverless installed if you will deploy functions or hosted MCP servers.
- For Harbor/air-gap: all charted images mirrored to Harbor, a pull secret, and a CA ConfigMap when
  Harbor uses a private CA.
- A clean External Secrets ownership boundary. The all-core chart owns External Secrets CRDs and
  validating webhooks, and cannot currently reuse an operator installed by a different Helm release.

Check cluster prerequisites:

```bash
oc whoami
oc get storageclass
oc get knativeserving -A || true
oc api-resources | grep serving.knative.dev || true
```

If `serving.knative.dev` resources are absent, the core platform can still render and install, but
runtime-created functions and hosted MCP servers will fail until OpenShift Serverless is installed.

Check External Secrets ownership before creating the Project or applying Helm:

```bash
if oc get crd externalsecrets.external-secrets.io >/dev/null 2>&1; then
  echo "External Secrets is already installed; this all-core chart needs a clean cluster."
  exit 1
fi
```

Do not use Helm `--take-ownership` to override another release's CRDs or validating webhooks. The
current chart requires `eso.external-secrets.installCRDs=true` and has no supported reuse path.

Build chart dependencies:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## Public-image Route render

`values/platform-openshift.yaml` selects `Route` exposure and the `restricted-v2` platform profile.
It does not by itself clear every fixed UID/GID default inherited from chart dependencies. Render it
when you need to inspect the public-image Route shape, but use the complete Harbor overlay below
for an SCC-compatible restricted-v2 installation. A connected internal registry can use that same
overlay; "Harbor" here describes the tested overlay, not a requirement that the cluster be fully
air-gapped.

```bash
export RELEASE=falcone
export NS=falcone
export CHART=../falcone-charts/charts/in-falcone
export APPS_DOMAIN="$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}')"
export API_HOST="api.${APPS_DOMAIN}"
export CONSOLE_HOST="console.${APPS_DOMAIN}"
export IDENTITY_HOST="iam.${APPS_DOMAIN}"
export REALTIME_HOST="realtime.${APPS_DOMAIN}"
```

Render the Route resources without creating anything:

```bash
helm template "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-openshift.yaml" \
  -f "$CHART/values/profiles/standard.yaml" \
  --set global.namespace="$NS" \
  --set global.createNamespace=false \
  --set publicSurface.hostnames.api="$API_HOST" \
  --set publicSurface.hostnames.console="$CONSOLE_HOST" \
  --set publicSurface.hostnames.identity="$IDENTITY_HOST" \
  --set publicSurface.hostnames.realtime="$REALTIME_HOST" \
  > /tmp/falcone-openshift-public-render.yaml
```

Confirm the render contains four `Route` objects and no `Ingress` object. Continue with the full
overlay before installing into a restricted-v2 Project.

## OpenShift with Harbor or air-gap

Use this path for a restricted network where images are mirrored into Harbor, or as the starting
point for an internal registry on a connected cluster. It includes the per-component security
overrides required for OpenShift `restricted-v2`.

Set variables:

```bash
export RELEASE=falcone
export NS=falcone-prod
export CHART=../falcone-charts/charts/in-falcone
export HARBOR=harbor.example.com
export HARBOR_PROJECT=falcone
export REGISTRY_PREFIX="${HARBOR}/${HARBOR_PROJECT}"
export OCP_STORAGECLASS=<OCP_DEFAULT_CSI_STORAGECLASS>
export APPS_DOMAIN="$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}')"
```

Create or select the Project:

```bash
oc new-project "$NS" || oc project "$NS"
```

Create the Harbor pull secret. Replace the username, password, and email placeholders:

```bash
oc -n "$NS" create secret docker-registry harbor-pull \
  --docker-server="$HARBOR" \
  --docker-username='<harbor-robot-username>' \
  --docker-password='<harbor-robot-password>' \
  --docker-email='<ops@example.com>' \
  --dry-run=client -o yaml | oc apply -f -

oc -n "$NS" secrets link default harbor-pull --for=pull
```

If Harbor uses a private CA, create the CA ConfigMap expected by the overlay:

```bash
oc -n "$NS" create configmap harbor-ca \
  --from-file=ca.crt=./harbor-ca.pem \
  --dry-run=client -o yaml | oc apply -f -
```

Verify the storage class:

```bash
oc get storageclass "$OCP_STORAGECLASS"
```

Copy and fill the repo overlay. The overlay contains placeholders by design.

```bash
cp ../falcone-charts/deploy/openshift/values-openshift.yaml ./falcone-openshift-values.yaml

perl -0pi -e "s#harbor\\.example\\.com/falcone#${REGISTRY_PREFIX}#g; \
s#harbor\\.example\\.com#${HARBOR}#g; \
s#<OCP_DEFAULT_CSI_STORAGECLASS>#${OCP_STORAGECLASS}#g; \
s#falcone-prod#${NS}#g; \
s#api\\.apps\\.<ocp-cluster-domain>#api.${APPS_DOMAIN}#g; \
s#console\\.apps\\.<ocp-cluster-domain>#console.${APPS_DOMAIN}#g; \
s#iam\\.apps\\.<ocp-cluster-domain>#iam.${APPS_DOMAIN}#g; \
s#realtime\\.apps\\.<ocp-cluster-domain>#realtime.${APPS_DOMAIN}#g" \
  ./falcone-openshift-values.yaml
```

Install with the OpenShift platform values and the filled Harbor overlay:

```bash
helm upgrade --install "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-openshift.yaml" \
  -f "$CHART/values/profiles/standard.yaml" \
  -f ./falcone-openshift-values.yaml \
  --wait --wait-for-jobs --timeout 30m
```

Expected result:

```text
NAME: falcone
NAMESPACE: falcone-prod
STATUS: deployed
```

## Route verification

The OpenShift public surface renders four Routes for release `falcone`:

```bash
oc -n "$NS" get route falcone-in-falcone-api
oc -n "$NS" get route falcone-in-falcone-console
oc -n "$NS" get route falcone-in-falcone-identity
oc -n "$NS" get route falcone-in-falcone-realtime
```

The OpenShift values set Route exposure and HAProxy timeout annotations:

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

Check the rendered Route details:

```bash
oc -n "$NS" describe route falcone-in-falcone-api
oc -n "$NS" describe route falcone-in-falcone-realtime
```

Expected shape:

```text
TLS Termination: edge
Insecure Policy: Redirect
Annotations: haproxy.router.openshift.io/timeout=30s
```

## Readiness

```bash
oc -n "$NS" wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
oc -n "$NS" rollout status deploy/falcone-control-plane --timeout=5m
oc -n "$NS" rollout status deploy/falcone-control-plane-executor --timeout=5m
oc -n "$NS" rollout status deploy/falcone-web-console --timeout=5m
oc -n "$NS" rollout status deploy/falcone-keycloak --timeout=5m
oc -n "$NS" get pods
```

Expected results include:

```text
job.batch/falcone-in-falcone-bootstrap condition met
deployment "falcone-control-plane" successfully rolled out
deployment "falcone-control-plane-executor" successfully rolled out
deployment "falcone-web-console" successfully rolled out
deployment "falcone-keycloak" successfully rolled out
```

Check stateful services:

```bash
oc -n "$NS" rollout status statefulset/falcone-postgresql --timeout=10m
oc -n "$NS" rollout status statefulset/falcone-postgresql-vector --timeout=10m
oc -n "$NS" rollout status statefulset/falcone-documentdb --timeout=10m
oc -n "$NS" rollout status statefulset/falcone-kafka --timeout=10m
oc -n "$NS" rollout status statefulset/openbao --timeout=10m
```

## SCC and non-root verification

The full `deploy/openshift/values-openshift.yaml` overlay used in the previous section clears the
fixed pod-level UID/GID and `fsGroup` values that would conflict with restricted-v2. The smaller
`values/platform-openshift.yaml` file only selects the OpenShift platform and Route surface; do not
use it alone as an SCC compatibility override.

Check the SCC annotation on running pods:

```bash
oc -n "$NS" get pod -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.openshift\.io/scc}{"\n"}{end}' | sort
```

Check that pod specs are not pinning a UID or fsGroup:

```bash
oc -n "$NS" get pods -o json \
  | jq -r '.items[] | [.metadata.name, (.spec.securityContext.runAsUser // "unset"), (.spec.securityContext.fsGroup // "unset")] | @tsv'
```

Expected shape: pod-level `runAsUser` and `fsGroup` are `unset` before admission or are values from
the Project range after OpenShift admission. A fixed image UID/GID is a signal to review the
rendered values before deployment.

## Function and MCP runtime verification

Functions and hosted MCP servers require OpenShift Serverless:

```bash
oc get knativeserving -A
oc api-resources | grep serving.knative.dev
```

The chart grants the control-plane service account namespace-scoped access to
`serving.knative.dev/services` through its function-executor RBAC. Verify the RoleBinding:

```bash
oc -n "$NS" get rolebinding | grep control-plane
oc -n "$NS" auth can-i create services.serving.knative.dev \
  --as system:serviceaccount:"$NS":falcone-control-plane \
  -n "$NS"
```

The `--as` form requires permission to impersonate the service account. Where your operator account
has that permission, the expected result is:

```text
yes
```

## Scaling

Use chart profiles as the source of truth:

```text
../falcone-charts/charts/in-falcone/values/profiles/all-in-one.yaml
../falcone-charts/charts/in-falcone/values/profiles/standard.yaml
../falcone-charts/charts/in-falcone/values/profiles/ha.yaml
```

Upgrade to the HA profile by changing the layered profile file:

```bash
helm upgrade "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-openshift.yaml" \
  -f "$CHART/values/profiles/ha.yaml" \
  -f ./falcone-openshift-values.yaml \
  --wait --wait-for-jobs --timeout 30m
```

Render before applying to inspect replica counts and image references:

```bash
helm template "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-openshift.yaml" \
  -f "$CHART/values/profiles/ha.yaml" \
  -f ./falcone-openshift-values.yaml > /tmp/falcone-openshift-render.yaml
```

Do not disable core services or set core replicas to zero; chart validation rejects those shapes.

## Backups and restore

Use both backup layers:

- Tenant-level backup and restore workflows: [Backup & Restore](/operations/backup-restore).
- Platform secret/KV and Helm rollback evidence scripts:
  `scripts/system-changes/make-all-services-core/backup-kv.sh`,
  `parity-check.sh`, `migrate-platform-secrets.sh`, `diff-rollout.sh`, and `restore-kv.sh`.

Example platform backup:

```bash
scripts/system-changes/make-all-services-core/backup-kv.sh \
  --output /secure/path/falcone-kv-backup.tgz
```

Example restore dry run:

```bash
scripts/system-changes/make-all-services-core/restore-kv.sh \
  --backup /secure/path/falcone-kv-backup.tgz \
  --dry-run
```

## Legacy plain-manifest reference

The repository's [no-Helm OpenShift/Harbor page](/operations/openshift-airgapped-harbor) is a frozen
`0.3.0` reference, not a supported new, fresh, or upgrade path for C-25/chart `0.3.1`. It omits the
mandatory webhook signing-key credential and lifecycle resources. Copying only a newer image into
those manifests is unsafe and unsupported. Use this matched Helm guide and the
[Webhook Signing-Key Lifecycle runbook](/operations/webhook-signing-key-lifecycle) only for new,
fresh, or already Helm-managed deployments. No supported or safely rehearsed resource-import path
moves a manual installation into Helm. An existing manual `0.3.0` installation must remain pinned to
`0.3.0` and continue its existing manual process until a separate manual-to-Helm migration is
approved and rehearsed. The lifecycle runbook's legacy adoption migrates webhook ciphertext inside
an existing Helm release; it does not import or transfer ownership of plain-manifest resources.

## Teardown

```bash
helm uninstall "$RELEASE" --namespace "$NS"
oc delete project "$NS"
```

Only delete the Project when it is dedicated to this Falcone install.
