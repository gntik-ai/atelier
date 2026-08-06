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

## Installation paths

| Path | Image source | Values layering | Use it when |
| --- | --- | --- | --- |
| Public prebuilt | GHCR release images | `values/prod.yaml` + `values/platform-openshift.yaml` + `values/profiles/standard.yaml` | The cluster can pull the published images. |
| Harbor or air-gap | Prebuilt images mirrored to a private registry | The three layers above + a completed copy of `deploy/openshift/values-openshift.yaml` | The cluster is restricted or must use an approved registry. |
| [Build from source](#build-from-source-install-openshift-builds) | Six OpenShift Builds fed by a GitLab mirror | The three base layers + a completed OpenShift site overlay + an operator-owned source-build values file | OpenShift must build Falcone inside the Project and update workloads from ImageStreams. |

The default remains the public prebuilt-image path. Build from source is opt-in and is not
supported on vanilla Kubernetes.

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

## Build-from-source install (OpenShift Builds)

Chart `0.4.0` adds an opt-in path that builds the six released Falcone images from a mirrored
monorepo. When the mode is enabled, the chart creates one Docker-strategy `BuildConfig` and one
`ImageStream` for each of these services:

```text
control-plane
control-plane-executor
web-console
workflow-worker
mcp-runtime
fn-runtime
```

`ConfigChange` starts the first six builds. A secret-protected GitLab Push webhook starts later
builds. The first four services are Deployments and receive OpenShift image-change triggers.
`fn-runtime` and `mcp-runtime` are launched dynamically, so their new stream image is used only by
function or MCP pods created after the build completes.

This mode requires the OpenShift Build and Image APIs and the OpenShift internal registry. Enabling
it on a Kubernetes cluster without those APIs produces unsupported resources and the install will
fail. Disabling the mode renders no Build API objects and preserves the configured GHCR or Harbor
images.

### Source-build prerequisites

Complete the [general prerequisites](#prerequisites) and build the chart dependencies first. You
also need:

- an existing Project, or permission to create one;
- a GitLab mirror of the Falcone monorepo that OpenShift builder pods can reach;
- network access from GitLab to the cluster API endpoint used by the webhook URLs;
- a same-Project Git source Secret when that mirror is private;
- the OpenShift internal image registry; and
- a same-Project Secret whose `WebHookSecretKey` entry authenticates the six GitLab webhooks; and
- OpenSSL, used below to create that key without exposing it in a command argument.

Set the working variables and select or create the Project:

```bash
export RELEASE=falcone
export NS=falcone
export CHART=../falcone-charts/charts/in-falcone
export TAG=latest

oc get project "$NS" >/dev/null 2>&1 || oc new-project "$NS"
oc project "$NS"
```

Confirm the required APIs and internal registry are available:

```bash
oc api-resources --api-group=build.openshift.io | grep '^buildconfigs'
oc api-resources --api-group=image.openshift.io | grep '^imagestreams'
oc registry info --internal
```

Create a 64-character webhook secret without placing its value in a command argument, values file,
Git history, or Helm release history:

```bash
openssl rand -hex 32 | tr -d '\n' | \
  oc -n "$NS" create secret generic falcone-gitlab-webhook \
    --from-file=WebHookSecretKey=/dev/stdin \
    --dry-run=client -o yaml | oc apply -f -

test "$(oc -n "$NS" get secret falcone-gitlab-webhook \
  -o jsonpath='{.data.WebHookSecretKey}' | base64 -d | wc -c | tr -d ' ')" -eq 64
```

For a private mirror, create a `kubernetes.io/basic-auth` or `kubernetes.io/ssh-auth` source Secret
from protected local files, in the same Project as the `BuildConfig`. Set only the Secret's name in
the Helm values. Do not put a username, password, private key, or token in `--set` or a values file,
and do not add cluster-wide RBAC. If local policy restricts Secret use by builds, grant only the
Project's `builder` service account the minimum access required for that one Secret.

### Enable and install the mode

Prepare `falcone-openshift-site-values.yaml` using the
[Harbor/air-gap procedure](#openshift-with-harbor-or-air-gap), or supply an equivalent reviewed
site overlay that clears fixed UID/GID defaults for `restricted-v2`, selects storage, and configures
the remaining third-party images. On a connected cluster, remove the Harbor registry, pull-Secret,
CA, and `airgap` settings from that copy while retaining its SCC-compatible security overrides.

Create `build-from-source-values.yaml`. This file contains Secret names, never Secret bytes:

```yaml
global:
  openshiftBuild:
    enabled: true
    git:
      uri: https://gitlab.example.com/platform/falcone.git
      ref: main
      sourceSecret: "" # Same-Project source Secret name; empty for a public mirror.
    webhookSecret: falcone-gitlab-webhook
    tag: latest
```

Apply it after the production, OpenShift, and standard-profile layers. The Project already exists,
so the chart must not attempt to own its Namespace:

```bash
helm upgrade --install "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-openshift.yaml" \
  -f "$CHART/values/profiles/standard.yaml" \
  -f ./falcone-openshift-site-values.yaml \
  -f ./build-from-source-values.yaml \
  --set global.namespace="$NS" \
  --set global.createNamespace=false \
  --wait --wait-for-jobs --timeout 30m
```

Source-build mode replaces only the six released Falcone service images. PostgreSQL, Keycloak,
APISIX, and the other third-party images keep the configuration from the site overlay. Because the
six BuildConfig and ImageStream names are namespace-scoped service identities rather than
release-prefixed names, run only one source-build Falcone release in a Project.

### Verify the initial builds

The install creates exactly six initial Builds through `ConfigChange`. List them oldest first:

```bash
oc -n "$NS" get builds --sort-by=.metadata.creationTimestamp
```

Inspect the latest Build and its cause for every service:

```bash
for svc in control-plane control-plane-executor web-console workflow-worker mcp-runtime fn-runtime; do
  build=$(oc -n "$NS" get builds -l "buildconfig=in-falcone-$svc" \
    --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
  oc -n "$NS" get build "$build" \
    -o jsonpath='{.metadata.name}{"\t"}{.status.phase}{"\t"}{.spec.triggeredBy[*].message}{"\n"}'
done
unset build
```

The first cause is `Build configuration change`. Follow a build with
`oc -n "$NS" logs -f build/<build-name>` when it is not `Complete`. A successful build populates
the matching stream tag. For example:

```bash
oc -n "$NS" get istag "in-falcone-web-console:$TAG" \
  -o jsonpath='{.image.dockerImageReference}{"\n"}{.image.metadata.name}{"\n"}'
```

The first line is the internal-registry pullspec and the second is the immutable image digest.

### Register the GitLab Push webhooks

The chart's release notes contain one command for each service:

```bash
helm get notes "$RELEASE" -n "$NS"
```

Alternatively, retrieve the Secret at execution time and print the six URLs to a controlled
terminal:

```bash
webhook_secret=$(oc -n "$NS" get secret falcone-gitlab-webhook \
  -o jsonpath='{.data.WebHookSecretKey}' | base64 -d)
server=$(oc whoami --show-server)
for svc in control-plane control-plane-executor web-console workflow-worker mcp-runtime fn-runtime; do
  printf '%s/apis/build.openshift.io/v1/namespaces/%s/buildconfigs/in-falcone-%s/webhooks/%s/gitlab\n' \
    "$server" "$NS" "$svc" "$webhook_secret"
done
unset webhook_secret server
```

Each URL contains the webhook secret and is therefore a credential. Do not paste it into tickets,
chat, CI logs, or shell history. In the mirrored GitLab project, add each URL under **Settings >
Webhooks**, select **Push events**, and keep SSL verification enabled. Rotate the Secret and update
all six registrations if any URL is exposed.

The OpenShift API must permit GitLab's unauthenticated request to create the webhook subresource.
Grant only `create` on `buildconfigs/webhooks.build.openshift.io` to the ingress identity required by
your cluster policy; do not grant create/update access to ordinary `BuildConfig` resources.

### Verify push, image update, and rollout

Before pushing a commit to the mirrored ref, record each Deployment generation and image:

```bash
for svc in control-plane control-plane-executor web-console workflow-worker; do
  oc -n "$NS" get deployment "$RELEASE-$svc" \
    -o jsonpath='{.metadata.name}{"\t"}{.metadata.generation}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}'
done
```

Push a commit to the configured GitLab ref. Do not run `helm upgrade`. Confirm the new Build has a
GitLab webhook cause, reaches `Complete`, and updates the stream tag:

```bash
svc=web-console
build=$(oc -n "$NS" get builds -l "buildconfig=in-falcone-$svc" \
  --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
oc -n "$NS" get build "$build" \
  -o jsonpath='{.metadata.name}{"\t"}{.status.phase}{"\t"}{.spec.triggeredBy[*].message}{"\n"}'
oc -n "$NS" get istag "in-falcone-$svc:$TAG" \
  -o jsonpath='{.image.dockerImageReference}{"\n"}{.image.metadata.name}{"\n"}'
```

The corresponding image-change trigger updates only the Deployment whose stream changed. Verify
all four Deployment contracts and wait for their current rollouts:

```bash
for svc in control-plane control-plane-executor web-console workflow-worker; do
  oc -n "$NS" get deployment "$RELEASE-$svc" \
    -o go-template='{{ index .metadata.annotations "image.openshift.io/triggers" }}{{ "\n" }}'
  oc -n "$NS" rollout status "deployment/$RELEASE-$svc" --timeout=15m
done
```

The image and generation for the service rebuilt through GitLab must differ from the values
recorded before the push, with no intervening Helm operation.

The dynamic runtimes do not have Deployments to roll. Confirm that their configuration points at
the two internal stream tags:

```bash
oc -n "$NS" get deployment "$RELEASE-control-plane" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="control-plane")].env[?(@.name=="FN_RUNTIME_IMAGE")].value}{"\n"}'
oc -n "$NS" get configmap in-falcone-runtime-env \
  -o jsonpath='{.data.MCP_RUNTIME_IMAGE}{"\n"}'
```

Function and MCP pods or revisions that already exist keep their immutable image. Pods or revisions
created after the corresponding build use the updated stream tag.

### Troubleshooting and rollback

| Symptom | Checks and action |
| --- | --- |
| Build is `Failed` | Run `oc -n "$NS" describe build <name>` and `oc -n "$NS" logs build/<name>`. Check mirror DNS/TLS/reachability, the configured ref, same-Project `sourceSecret`, and the service Dockerfile path. |
| Webhook returns `403`; no Build appears | Compare the Secret name/key and URL, then check authorization for `create` on the `buildconfigs/webhooks` subresource. A wrong URL secret and missing webhook RBAC are separate failures. Never grant GitLab general `BuildConfig` write access. |
| Build is `Complete`; stream tag is absent | Inspect `oc -n "$NS" describe build <name>` and its output reference. Check the internal registry operator and Project image-push permissions. |
| Stream updates; Deployment does not | Inspect the `image.openshift.io/triggers` annotation, stream tag/namespace, container name, Deployment events, and rollout status. Helm and the image-trigger controller must target the same stable internal pullspec. |
| New pod cannot pull the internal image | Inspect pod events and the stream's `dockerImageReference`. Fix Project service-account/image-puller permissions or internal-registry trust directly; registry mirror policy is not a generic fix for the internal registry. |

To roll back, rerun the same Helm command with `global.openshiftBuild.enabled=false` or remove the
source-build overlay. Helm removes its Build API objects and the six services return to their
configured prebuilt image references. Confirm those images are pullable before disabling the mode.
The complete values contract is in [Helm Configuration](/operations/helm-configuration#openshift-build-from-source-values).

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
