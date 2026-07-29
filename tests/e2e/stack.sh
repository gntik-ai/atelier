#!/usr/bin/env bash
# Kubernetes E2E stack for Falcone (kind test cluster).
# Deploys with HELM into an EPHEMERAL namespace. `down` ALWAYS removes the workloads; the cluster stays.
#
# Kubeconfig: if ./kubeconfig-test-cluster-b.yaml exists at the repo root it is used automatically
# (override with E2E_KUBECONFIG=<path>). NEVER commit that file — keep it gitignored.
#
# Usage: stack.sh up|down|status
# Config (env): E2E_NAMESPACE (default falcone-e2e) · E2E_HELM_CHART (path or chart ref) ·
#   E2E_HELM_VALUES (values file) · E2E_HELM_RELEASE (default falcone) ·
#   E2E_AUX_NAMESPACES (space-separated ephemeral dependency namespaces) ·
#   E2E_FWD ("svc/name:local:remote ...") · E2E_BASE_URL · E2E_HEALTH_PATH (e.g. /api/health) ·
#   E2E_CONSOLE_PASSWORD (optional superadmin bootstrap Secret) ·
#   DEPLOY_CMD (full override) · E2E_CONFIRM_CONTEXT=1 (allow non-local context)
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

# --- kubeconfig (the dedicated test-cluster file wins) ---
KCFG="${E2E_KUBECONFIG:-kubeconfig-test-cluster-b.yaml}"
DEDICATED=0
if [ -f "$KCFG" ]; then
  export KUBECONFIG="$(cd "$(dirname "$KCFG")" && pwd)/$(basename "$KCFG")"
  DEDICATED=1
fi

NS="${E2E_NAMESPACE:-falcone-e2e}"
AUX_NAMESPACES="${E2E_AUX_NAMESPACES:-}"
REL="${E2E_HELM_RELEASE:-falcone}"
PIDFILE="tests/e2e/.port-forward.pids"
FWD="${E2E_FWD:-svc/falcone-frontend:3000:80 svc/falcone-backend:8080:80 svc/falcone-keycloak:8180:8080 svc/falcone-observability:9090:9090}"
BASE="${E2E_BASE_URL:-http://localhost:3000}"

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'." >&2; exit 2; }; }

validate_namespaces() {
  local namespace
  for namespace in "$NS" $AUX_NAMESPACES; do
    if [[ ! "$namespace" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || [ "${#namespace}" -gt 63 ]; then
      echo "Refusing invalid namespace '$namespace'." >&2
      exit 2
    fi
    case "$namespace" in kube-system|kube-public|kube-node-lease|default|openshift*) echo "Refusing protected namespace '$namespace'." >&2; exit 2;; esac
  done
  for namespace in $AUX_NAMESPACES; do
    case "$namespace" in
      "$NS"-?*) : ;;
      *) echo "Refusing auxiliary namespace '$namespace': it must start with '${NS}-'." >&2; exit 2 ;;
    esac
  done
}

guard() {
  if [ -n "${E2E_KUBECONFIG:-}" ] && [ ! -f "$KCFG" ]; then
    echo "Explicit E2E_KUBECONFIG '$KCFG' does not exist. Refusing to use another context." >&2
    exit 2
  fi
  local ctx; ctx="$(kubectl config current-context 2>/dev/null || true)"
  [ -z "$ctx" ] && { echo "No kube-context. Expected ./kubeconfig-test-cluster-b.yaml or a local cluster." >&2; exit 2; }
  if [ "$DEDICATED" -eq 1 ]; then
    echo ">> kube-context: $ctx (dedicated test kubeconfig)"
  else
    echo ">> kube-context: $ctx"
  fi
  case "$ctx" in
    kind-*|k3d-*|minikube|*crc*|*local*) : ;;
    *) [ "${E2E_CONFIRM_CONTEXT:-0}" = "1" ] || { echo "Context '$ctx' does not look like a test cluster. Refusing (set E2E_CONFIRM_CONTEXT=1 to override)." >&2; exit 2; } ;;
  esac
  validate_namespaces
}

find_chart() {
  [ -n "${E2E_HELM_CHART:-}" ] && { echo "$E2E_HELM_CHART"; return 0; }
  for c in charts/falcone deploy/helm helm/falcone deploy/chart chart helm; do
    [ -f "$c/Chart.yaml" ] && { echo "$c"; return 0; }
  done
  return 1
}

healthy() {
  echo ">> Verifying ALL services are operational ..."
  # Iterates EVERY Deployment and StatefulSet in the namespace, so the FerretDB gateway
  # (Deployment) and DocumentDB engine (StatefulSet) are auto-covered when E2E_FERRETDB=true —
  # no FerretDB-specific wait logic is needed (add-ferretdb-document-store-e2e #464, task 8.3).
  local namespace dep sts bad notready
  for namespace in "$NS" $AUX_NAMESPACES; do
    echo ">> Checking workloads in namespace '$namespace' ..."
    for dep in $(kubectl get deployment -n "$namespace" -o name 2>/dev/null); do
      kubectl rollout status "$dep" -n "$namespace" --timeout=10m
    done
    for sts in $(kubectl get statefulset -n "$namespace" -o name 2>/dev/null); do
      kubectl rollout status "$sts" -n "$namespace" --timeout=10m
    done
    bad=$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | grep -Evc 'Running|Completed' || true)
    notready=$(kubectl get pods -n "$namespace" --no-headers 2>/dev/null | awk '$3=="Running"{split($2,a,"/"); if(a[1]!=a[2]) c++} END{print c+0}')
    if [ "${bad:-0}" -gt 0 ] || [ "${notready:-0}" -gt 0 ]; then
      echo "!! Unhealthy pods in '$namespace':"; kubectl get pods -n "$namespace"; exit 1
    fi
  done
  echo ">> All pods Running/Completed and Ready."
}

smoke() {
  [ -z "${E2E_HEALTH_PATH:-}" ] && return 0
  echo ">> HTTP smoke check ${BASE}${E2E_HEALTH_PATH} ..."
  for i in $(seq 1 30); do
    curl -fsS "${BASE}${E2E_HEALTH_PATH}" >/dev/null 2>&1 && { echo ">> Smoke OK."; return 0; }
    sleep 2
  done
  echo "!! Smoke check failed: ${BASE}${E2E_HEALTH_PATH}" >&2; exit 1
}

stop_forwards() {
  if [ -f "$PIDFILE" ]; then
    xargs -r kill <"$PIDFILE" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
}

case "${1:-up}" in
  up)
    require kubectl; guard
    echo ">> Recreating namespace '$NS' (clean slate) ..."
    kubectl delete namespace "$NS" --ignore-not-found --wait=true
    kubectl create namespace "$NS"
    for namespace in $AUX_NAMESPACES; do
      kubectl delete namespace "$namespace" --ignore-not-found --wait=true
      kubectl create namespace "$namespace"
    done

    # ---- SeaweedFS image pre-pull (add-seaweedfs-storage-e2e, task 5.1) ----
    # When E2E_STORAGE_BACKEND=seaweedfs, pre-pull the SeaweedFS and its filer
    # init-container images so the kind nodes do not hit ImagePullBackOff on first
    # deploy.  `kind load docker-image` is best-effort: it is a no-op on remote /
    # multi-node kind where images come directly from Docker Hub or a registry.
    # We do NOT fail `up` if either command is unavailable or unsuccessful.
    if [ "${E2E_STORAGE_BACKEND:-}" = "seaweedfs" ]; then
      echo ">> [SeaweedFS] Pre-pulling images (best-effort, non-fatal) ..."
      docker pull chrislusf/seaweedfs:4.33 2>/dev/null \
        && kind load docker-image chrislusf/seaweedfs:4.33 2>/dev/null || true
      docker pull bitnamilegacy/postgresql:17.2.0 2>/dev/null \
        && kind load docker-image bitnamilegacy/postgresql:17.2.0 2>/dev/null || true
    fi

    # ---- FerretDB image pre-pull (add-ferretdb-document-store-e2e #464, task 8.1) ----
    # When E2E_FERRETDB=true, pre-pull the DocumentDB engine + FerretDB gateway images so the kind
    # nodes do not hit ImagePullBackOff on first deploy. DocumentDB and FerretDB are core in the
    # in-falcone chart; ../falcone-charts/tests/e2e/values-ferretdb-realtime-e2e.yaml only tunes realtime replication
    # and control-plane env — NOT a separate Helm release or E2E_DOCUMENT_BACKEND block.
    # ENGINE-FIRST ordering is enforced by the chart's documentdb readiness dependency; healthy()
    # then waits on every Deployment and StatefulSet (both FerretDB components included). Best-effort.
    if [ "${E2E_FERRETDB:-}" = "true" ]; then
      echo ">> [FerretDB] Pre-pulling DocumentDB engine + gateway images (best-effort, non-fatal) ..."
      docker pull ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0 2>/dev/null \
        && kind load docker-image ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0 2>/dev/null || true
      docker pull ghcr.io/ferretdb/ferretdb:2.7.0 2>/dev/null \
        && kind load docker-image ghcr.io/ferretdb/ferretdb:2.7.0 2>/dev/null || true
    fi

    # Pre-install: seed required Kubernetes secrets so chart components can start.
    # The Bitnami PostgreSQL container creates an initial user from POSTGRESQL_USERNAME
    # and POSTGRESQL_PASSWORD loaded via envFromSecrets (in-falcone-postgresql secret).
    # Temporal's schema jobs authenticate as that same user, so pre-seed their credential
    # Secret with the same ephemeral value before the chart's credential hook runs.
    echo ">> Creating pre-install secrets in '$NS' ..."
    require openssl
    DATABASE_PASSWORD="${E2E_DATABASE_PASSWORD:-$(openssl rand -hex 32)}"
    kubectl create secret generic in-falcone-postgresql \
      --from-literal=POSTGRESQL_USERNAME=falcone \
      --from-literal=POSTGRESQL_PASSWORD="${DATABASE_PASSWORD}" \
      --from-literal=POSTGRESQL_POSTGRES_PASSWORD="${DATABASE_PASSWORD}" \
      --from-literal=POSTGRESQL_DATABASE=in_falcone \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret generic in-falcone-temporal \
      --from-literal=password="${DATABASE_PASSWORD}" \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    unset DATABASE_PASSWORD
    # Kafka credentials (Bitnami KRaft; values taken from the kind install reference).
    kubectl create secret generic in-falcone-kafka \
      --from-literal=KAFKA_CFG_PROCESS_ROLES=broker,controller \
      --from-literal=KAFKA_CFG_NODE_ID=0 \
      --from-literal=KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=0@localhost:9093 \
      --from-literal=KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
      --from-literal=KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://falcone-kafka:9092 \
      --from-literal=KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
      --from-literal=KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER \
      --from-literal=KAFKA_CFG_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    # Keycloak identity client (placeholder values; not used by flows specs).
    kubectl create secret generic in-falcone-identity-client \
      --from-literal=client-id=in-falcone-console \
      --from-literal=client-secret=e2e-placeholder-secret \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    # Credentialed console specs provide the ephemeral bootstrap password through
    # the process environment. Keep generic non-console specs compatible by only
    # creating the Secret when that value was explicitly supplied.
    if [ -n "${E2E_CONSOLE_PASSWORD:-}" ]; then
      kubectl create secret generic in-falcone-superadmin \
        --from-literal=password="${E2E_CONSOLE_PASSWORD}" \
        -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    fi

    # ---- DocumentDB / FerretDB secrets (add-ferretdb-realtime-cdc-remediation #460) ----
    # The documentdb sub-chart (postgres-documentdb engine) requires in-falcone-documentdb
    # with the admin credentials it uses for CREATE EXTENSION and the superuser password.
    # The logical-replication init job (logicalReplication.enabled=true in chart values)
    # creates the falcone_cdc_repl role and reads its password from in-falcone-documentdb-replication.
    # The control-plane pod reads REALTIME_DOCUMENTDB_URL from the same secret (optional:true,
    # so the pod starts even if absent; realtime is gracefully disabled until it exists).
    # These are e2e-only credentials — no production values here.
    if [ "${E2E_REALTIME_MONGO:-}" = "true" ] || [ "${E2E_FERRETDB:-}" = "true" ]; then
      # DocumentDB engine admin credentials. The engine is the OFFICIAL postgres image (NOT Bitnami),
      # which reads POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB; the component-wrapper injects these
      # via envFromSecrets:[in-falcone-documentdb]. Key names MUST be POSTGRES_* (verified against the
      # live in-falcone-documentdb secret) — POSTGRESQL_* (Bitnami) would be ignored by this image.
      echo ">> [FerretDB] Creating DocumentDB + replication secrets in '$NS' ..."
      kubectl create secret generic in-falcone-documentdb \
        --from-literal=POSTGRES_USER=falcone \
        --from-literal=POSTGRES_PASSWORD=falcone \
        --from-literal=POSTGRES_DB=postgres \
        -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

      # Logical replication role credentials + the full REPLICATION-privileged connection URL
      # that the realtime executor (REALTIME_DOCUMENTDB_URL) and the CDC bridge use.
      # The URL format mirrors the DocumentDB Service within the namespace:
      #   postgres://falcone_cdc_repl:<password>@<release>-documentdb:5432/postgres?sslmode=disable
      # The release name defaults to $REL (falcone) and the service name is <release>-documentdb.
      # IMPORTANT: this is a NORMAL connection URL — do NOT append ?replication=database. main.mjs
      # uses it for BOTH the WalReplicationClient (which adds replication mode itself) AND the
      # CollectionCatalog's normal pool (which runs SELECTs on documentdb_api_catalog.collections); a
      # replication-mode connection cannot run those queries. sslmode=disable: the engine ships no TLS.
      DOCDB_REPL_PASSWORD="${E2E_DOCDB_REPL_PASSWORD:-e2e-repl-secret}"
      DOCDB_SVC="${REL}-documentdb"
      DOCDB_REPL_URL="postgres://falcone_cdc_repl:${DOCDB_REPL_PASSWORD}@${DOCDB_SVC}:5432/postgres?sslmode=disable"
      kubectl create secret generic in-falcone-documentdb-replication \
        --from-literal=password="${DOCDB_REPL_PASSWORD}" \
        --from-literal=realtime-url="${DOCDB_REPL_URL}" \
        -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    fi

    # Pre-bootstrap PostgreSQL: the Temporal schema job needs PostgreSQL to already be
    # listening. If the all-core chart renders that job, deploy the PostgreSQL manifests
    # early (before helm install) so the job can connect.
    # We detect this via a rendered dry-run: if the chart would create a falcone-temporal-*
    # schema job, then PostgreSQL must be up first.
    echo ">> Installing Falcone with Helm into '$NS' ..."
    if [ -n "${DEPLOY_CMD:-}" ]; then
      eval "$DEPLOY_CMD"
    else
      require helm
      CHART="$(find_chart)" || { echo "No Helm chart found. Set E2E_HELM_CHART=<path-or-ref> (and E2E_HELM_VALUES if needed)." >&2; exit 2; }
      VALUES_FLAG="${E2E_HELM_VALUES:+-f "$E2E_HELM_VALUES"}"

      # ---- SeaweedFS Helm wiring (add-seaweedfs-storage-e2e, task 5.2) -----
      # SeaweedFS is core in the all-core chart, so E2E_STORAGE_BACKEND=seaweedfs no
      # longer needs a generated service-enable overlay. Keep any storage env
      # re-point in the E2E values file because `controlPlane.env` is a LIST and Helm
      # replaces lists across -f files rather than merging.
      #
      # The existing healthy() gate already iterates ALL Deployments + StatefulSets in
      # the namespace, so SeaweedFS readiness is auto-covered — no new wait logic here.
      #
      # task 5.3 note: `down` deletes the ephemeral namespace (kubectl delete namespace
      # "$NS"), removing ALL resources in it — SeaweedFS Deployments, StatefulSets, and
      # PVCs included. SeaweedFS is namespace-scoped and torn down with the namespace.
      SEAWEEDFS_OVERLAY=""
      if [ "${E2E_STORAGE_BACKEND:-}" = "seaweedfs" ]; then
        echo ">> [SeaweedFS] SeaweedFS is core in the all-core chart; no enable overlay needed."
      fi

      # Check if the Temporal schema job renders. When it does we MUST break the circular-dependency
      # deadlock: the schema job (pre-install hook) needs PostgreSQL, and the bootstrap job
      # (post-install hook) needs the Temporal frontend running BEFORE the workflow-worker
      # starts (otherwise the worker crashes on missing namespace and helm --wait never
      # finishes).  Strategy:
      #   1. Deploy ALL non-hook resources via --no-hooks --wait=false (Helm adopts them).
      #   2. Wait for PostgreSQL then run the schema Job out-of-band.
      #   3. Wait for Temporal frontend then run the bootstrap Job out-of-band.
      #   4. Wait for all Deployments + StatefulSets to stabilise (retries self-heal).
      TEMPORAL_ENABLED=0
      helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation 2>/dev/null \
        | grep -q 'falcone-temporal-schema' && TEMPORAL_ENABLED=1 || true

      if [ "$TEMPORAL_ENABLED" -eq 1 ]; then
        echo ">> Temporal schema job rendered: phased deploy to break bootstrap deadlock ..."
        # Phase 1 — deploy everything without hooks; no --wait so CrashLoopBackOffs are OK.
        helm upgrade --install --skip-schema-validation --server-side=false --no-hooks \
          "$REL" "$CHART" -n "$NS" $VALUES_FLAG

        # Phase 2 — wait for PostgreSQL then run schema job.
        echo ">> Waiting for PostgreSQL ..."
        kubectl rollout status statefulset/"$REL"-postgresql -n "$NS" --timeout=5m
        echo ">> Running Temporal schema migration ..."
        helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation \
          -s templates/temporal/schema-job.yaml 2>/dev/null \
          | kubectl apply -n "$NS" -f -
        kubectl wait job/"$REL"-temporal-schema -n "$NS" --for=condition=complete --timeout=3m \
          || kubectl wait job/"$REL"-temporal-schema -n "$NS" --for=condition=failed --timeout=30s || true
        kubectl logs -n "$NS" job/"$REL"-temporal-schema 2>/dev/null | tail -5 || true

        # Phase 3 — wait for Temporal frontend then run bootstrap job.
        echo ">> Waiting for Temporal frontend ..."
        kubectl rollout status deployment/"$REL"-temporal-frontend -n "$NS" --timeout=5m
        echo ">> Running Temporal namespace bootstrap ..."
        helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation \
          -s templates/temporal/bootstrap-job.yaml 2>/dev/null \
          | kubectl apply -n "$NS" -f -
        kubectl wait job/"$REL"-temporal-bootstrap -n "$NS" --for=condition=complete --timeout=5m \
          || kubectl wait job/"$REL"-temporal-bootstrap -n "$NS" --for=condition=failed --timeout=30s || true
        kubectl logs -n "$NS" job/"$REL"-temporal-bootstrap 2>/dev/null | tail -5 || true
      else
        # Standard install with hooks. Do not ask Helm to wait for every workload:
        # post-install hooks create the Temporal namespace and bootstrap Keycloak,
        # while the workflow worker and credentialed tests depend on those hooks.
        # The explicit healthy() gate below owns full workload readiness after the
        # hooks complete and avoids a Helm wait/bootstrap circular dependency.
        # --skip-schema-validation: in-falcone chart has strict JSON-schema constraints that
        # reject unknown/overridden keys even in valid e2e overlay combinations (known quirk).
        helm upgrade --install --skip-schema-validation --server-side=false "$REL" "$CHART" -n "$NS" $VALUES_FLAG --timeout 15m
      fi
    fi
    # Clean up SeaweedFS overlay temp file if it was created.
    [ -n "${SEAWEEDFS_OVERLAY:-}" ] && rm -f "$SEAWEEDFS_OVERLAY" || true
    healthy
    echo ">> Port-forwarding console, API, identity, and observability services ..."
    stop_forwards; : > "$PIDFILE"
    for f in $FWD; do
      svc="${f%%:*}"; rest="${f#*:}"; lport="${rest%%:*}"; rport="${rest##*:}"
      kubectl port-forward "$svc" "$lport:$rport" -n "$NS" >/dev/null 2>&1 &
      echo $! >> "$PIDFILE"; disown 2>/dev/null || true
    done
    sleep 3
    smoke
    echo "E2E_BASE_URL=$BASE"
    echo ">> Stack up and healthy in '$NS'. 'stack.sh down' removes all pods."
    ;;
  down)
    command -v kubectl >/dev/null 2>&1 || exit 0
    stop_forwards
    guard
    # Deletes the whole ephemeral namespace — the FerretDB gateway (Deployment) and DocumentDB
    # engine (StatefulSet + PVC) are namespace-scoped and torn down with it, same as every other
    # component (add-ferretdb-document-store-e2e #464, task 8.4).
    for namespace in "$NS" $AUX_NAMESPACES; do
      if kubectl get namespace "$namespace" >/dev/null 2>&1; then
        kubectl delete namespace "$namespace" --wait=false
        if ! kubectl wait --for=delete "namespace/$namespace" --timeout=60s; then
          echo ">> Namespace '$namespace' still terminating; force-deleting its remaining ephemeral pods ..."
          kubectl delete pod --all -n "$namespace" --force --grace-period=0 --ignore-not-found || true
          kubectl wait --for=delete "namespace/$namespace" --timeout=60s
        fi
      fi
    done
    echo ">> Ephemeral namespace(s) deleted (all pods removed). Cluster left intact."
    ;;
  status)
    kubectl get pods -n "$NS" 2>/dev/null || echo "namespace '$NS' not present"
    ;;
  *) echo "usage: stack.sh up|down|status" >&2; exit 1;;
esac
