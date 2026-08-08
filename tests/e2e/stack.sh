#!/usr/bin/env bash
# Kubernetes E2E stack for Falcone.
# The default lifecycle uses an EPHEMERAL namespace.  The explicitly attested
# preserve-existing lifecycle owns only its fresh Helm release and port-forwards.
#
# Kubeconfig: if ./kubeconfig-test-cluster-b.yaml exists at the repo root it is used automatically
# (override with E2E_KUBECONFIG=<path>). NEVER commit that file — keep it gitignored.
#
# Usage: stack.sh up|down|status
# Config (env): E2E_NAMESPACE (default falcone-e2e) · E2E_HELM_CHART (path or chart ref) ·
#   E2E_HELM_VALUES (values file) · E2E_HELM_RELEASE (default falcone) ·
#   E2E_FWD ("svc/name:local:remote ...") · E2E_BASE_URL · E2E_HEALTH_PATH (e.g. /api/health) ·
#   E2E_NAMESPACE_MODE (default ephemeral; or preserve-existing) ·
#   E2E_EXPECTED_NAMESPACE_UID (mandatory with preserve-existing) ·
#   DEPLOY_CMD (ephemeral-only full override) · E2E_CONFIRM_CONTEXT=1 (allow non-local context)
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
REL="${E2E_HELM_RELEASE:-falcone}"
MODE="${E2E_NAMESPACE_MODE:-ephemeral}"
case "$MODE" in
  ephemeral|preserve-existing) : ;;
  *) echo "Unsupported E2E_NAMESPACE_MODE. Use 'preserve-existing' or leave it unset." >&2; exit 2 ;;
esac
case "$NS" in
  ''|*[!a-z0-9.-]*|.*|*.) echo "E2E_NAMESPACE is not a safe Kubernetes namespace name." >&2; exit 2 ;;
esac
case "$REL" in
  ''|*[!A-Za-z0-9.-]*|.*|*.) echo "E2E_HELM_RELEASE is not a safe Helm release name." >&2; exit 2 ;;
esac

STATE_KEY="${NS}.${REL}"
if [ "$MODE" = "preserve-existing" ] && [ -z "${E2E_HARNESS_STATE_DIR:-}" ]; then
  echo "E2E_HARNESS_STATE_DIR is mandatory with E2E_NAMESPACE_MODE=preserve-existing." >&2
  exit 2
fi
STATE_DIR="${E2E_HARNESS_STATE_DIR:-tests/e2e/.harness-state-${STATE_KEY}}"
ACTIVE_FILE="$STATE_DIR/active"
PIDFILE="tests/e2e/.port-forward.pids"
if [ "$MODE" = "preserve-existing" ] || [ -f "$ACTIVE_FILE" ]; then
  PIDFILE="$STATE_DIR/port-forward.pids"
fi
FWD="${E2E_FWD:-svc/falcone-frontend:3000:80 svc/falcone-backend:8080:80}"
BASE="${E2E_BASE_URL:-http://localhost:3000}"

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'." >&2; exit 2; }; }

guard() {
  local ctx; ctx="$(kubectl config current-context 2>/dev/null || true)"
  [ -z "$ctx" ] && { echo "No kube-context. Expected ./kubeconfig-test-cluster-b.yaml or a local cluster." >&2; exit 2; }
  echo ">> kube-context: $ctx ${DEDICATED:+(dedicated test kubeconfig)}"
  if [ "$DEDICATED" -ne 1 ]; then
    case "$ctx" in
      kind-*|k3d-*|minikube|*crc*|*local*) : ;;
      *) [ "${E2E_CONFIRM_CONTEXT:-0}" = "1" ] || { echo "Context '$ctx' does not look like a test cluster. Refusing (set E2E_CONFIRM_CONTEXT=1 to override)." >&2; exit 2; } ;;
    esac
  fi
  case "$NS" in kube-system|kube-public|kube-node-lease|default|openshift*) echo "Refusing protected namespace '$NS'." >&2; exit 2;; esac
}

find_chart() {
  [ -n "${E2E_HELM_CHART:-}" ] && { echo "$E2E_HELM_CHART"; return 0; }
  for c in charts/falcone deploy/helm helm/falcone deploy/chart chart helm; do
    [ -f "$c/Chart.yaml" ] && { echo "$c"; return 0; }
  done
  return 1
}

healthy() {
  local selector=()
  if [ "$MODE" = "preserve-existing" ]; then
    selector=(-l "app.kubernetes.io/instance=$REL")
    echo ">> Verifying the installed Helm release is operational ..."
  else
    echo ">> Verifying ALL services are operational ..."
  fi
  # Ephemeral mode covers every Deployment and StatefulSet in its private namespace.
  # Preserve mode scopes every health read to this run's Helm release so adjacent
  # workloads cannot affect the result or appear in harness output.
  local workload_count=0
  for dep in $(kubectl get deployment -n "$NS" "${selector[@]}" -o name 2>/dev/null); do
    workload_count=$((workload_count + 1))
    kubectl rollout status "$dep" -n "$NS" --timeout=10m
  done
  for sts in $(kubectl get statefulset -n "$NS" "${selector[@]}" -o name 2>/dev/null); do
    workload_count=$((workload_count + 1))
    kubectl rollout status "$sts" -n "$NS" --timeout=10m
  done
  if [ "$MODE" = "preserve-existing" ] && [ "$workload_count" -eq 0 ] && [ -z "${E2E_HEALTH_TARGET:-}" ]; then
    echo "Preserve-existing health check found no release-labelled workloads; set E2E_HEALTH_TARGET to an explicit target." >&2
    return 1
  fi
  local bad notready
  bad=$(kubectl get pods -n "$NS" "${selector[@]}" --no-headers 2>/dev/null | awk 'NF >= 3 && $3 !~ /^(Running|Completed)$/ {c++} END {print c+0}')
  notready=$(kubectl get pods -n "$NS" "${selector[@]}" --no-headers 2>/dev/null | awk '$3=="Running"{split($2,a,"/"); if(a[1]!=a[2]) c++} END{print c+0}')
  if [ "${bad:-0}" -gt 0 ] || [ "${notready:-0}" -gt 0 ]; then
    echo "!! Unhealthy pods in '$NS':"; kubectl get pods -n "$NS" "${selector[@]}"; exit 1
  fi
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
  return 0
}

preserve_object_uid() {
  local kind="$1" name="$2" namespace="$3"
  if [ -n "$namespace" ]; then
    kubectl get "$kind" "$name" -n "$namespace" --ignore-not-found -o 'jsonpath={.metadata.uid}' 2>/dev/null
  else
    kubectl get "$kind" "$name" --ignore-not-found -o 'jsonpath={.metadata.uid}' 2>/dev/null
  fi
}

preserve_release_storage() {
  local storage uid
  for storage in secret configmap; do
    uid="$(preserve_object_uid "$storage" "sh.helm.release.v1.${REL}.v1" "$NS")" || return 1
    if [ -n "$uid" ]; then
      printf '%s' "$storage" >"$STATE_DIR/release-storage-kind"
      printf '%s' "$uid" >"$STATE_DIR/release-storage-uid"
      return 0
    fi
  done
  return 1
}

# Record only object identity and UID. In particular, never serialize Secret data
# while proving that adjacent identities and UIDs survive this run.
preserve_snapshot_adjacent() {
  local destination="$1" resource resources dynamic_snapshot
  dynamic_snapshot="${destination}.dynamic"
  : >"$dynamic_snapshot"
  kubectl get \
    all,configmaps,secrets,serviceaccounts,persistentvolumeclaims,roles.rbac.authorization.k8s.io,rolebindings.rbac.authorization.k8s.io,networkpolicies.networking.k8s.io,ingresses.networking.k8s.io,cronjobs.batch \
    -n "$NS" --ignore-not-found --no-headers \
    -o 'custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name,UID:.metadata.uid' \
    2>/dev/null >"$destination" || return 1

  # Include namespaced custom resources as well as built-ins.  The fixed query
  # above deliberately remains as a baseline for clients that cannot perform API
  # discovery; a real cluster must permit complete namespaced UID discovery.
  resources="$(kubectl api-resources --verbs=list --namespaced=true -o name 2>/dev/null)" || return 1
  while IFS= read -r resource; do
    [ -z "$resource" ] && continue
    case "$resource" in *[!a-z0-9./-]*) return 1 ;; esac
    case "$resource" in events|events.events.k8s.io|leases.coordination.k8s.io) continue ;; esac
    kubectl get "$resource" -n "$NS" --ignore-not-found --no-headers \
      -o 'custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name,UID:.metadata.uid' \
      2>/dev/null >>"$dynamic_snapshot" || return 1
  done <<<"$resources"
  LC_ALL=C sort -u "$destination" "$dynamic_snapshot" -o "$destination"
  rm -f "$dynamic_snapshot"
}

preserve_render_identities() {
  local manifest="$1" destination="$2"
  awk '
    function clean(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      gsub(/^["\047]|["\047]$/, "", value)
      return value
    }
    function flush() {
      if (kind == "" && name == "") return
      if (kind == "" || name == "") {
        print "INVALID|||" hook
      } else {
        print kind "|" name "|" namespace "|" hook
      }
    }
    function reset() {
      kind = ""; name = ""; namespace = ""; hook = 0; in_metadata = 0
    }
    BEGIN { reset() }
    /^---[[:space:]]*$/ { flush(); reset(); next }
    /^kind:[[:space:]]*/ {
      line = $0; sub(/^kind:[[:space:]]*/, "", line); kind = clean(line); next
    }
    /^metadata:[[:space:]]*$/ {
      metadata_indent = match($0, /[^[:space:]]/) - 1; in_metadata = 1; next
    }
    {
      if ($0 ~ /helm\.sh\/hook/) hook = 1
      if (in_metadata) {
        indent = match($0, /[^[:space:]]/) - 1
        if ($0 !~ /^[[:space:]]*$/ && indent <= metadata_indent) {
          in_metadata = 0
        } else if ($0 ~ /^[[:space:]]+name:[[:space:]]*/) {
          line = $0; sub(/^[[:space:]]+name:[[:space:]]*/, "", line); name = clean(line)
        } else if ($0 ~ /^[[:space:]]+namespace:[[:space:]]*/) {
          line = $0; sub(/^[[:space:]]+namespace:[[:space:]]*/, "", line); namespace = clean(line)
        }
      }
    }
    END { flush() }
  ' "$manifest" >"$destination"
}

preserve_render_has_namespace_mutating_hook() {
  local manifest="$1"
  awk '
    function flush() {
      if (hook && mutation && namespace_object && (cluster_api || command_tool || rbac_rule)) bad = 1
    }
    function reset() {
      hook = 0; mutation = 0; namespace_object = 0
      cluster_api = 0; command_tool = 0; rbac_rule = 0
    }
    BEGIN { reset() }
    /^---[[:space:]]*$/ { flush(); reset(); next }
    {
      line = tolower($0)
      if (line ~ /helm\.sh\/hook/) hook = 1
      if (line ~ /(^|[^a-z])(apply|annotate|create|delete|edit|label|patch|replace|update)([^a-z]|$)/) mutation = 1
      if (line ~ /(^|[^a-z])(kubectl|oc)([^a-z]|$)/) command_tool = 1
      if (line ~ /(^|[^a-z])(kubectl|oc)([^a-z]|$).*([^a-z])(namespace|namespaces|ns)(\/|[^a-z]|$)/ ||
          line ~ /^[[:space:]]*-[[:space:]]*(namespace|namespaces|ns)(\/|[[:space:]"\047,\]]|$)/) namespace_object = 1
      if (line ~ /\/api\/v1\/namespaces/) { cluster_api = 1; namespace_object = 1 }
      if (line ~ /resources[[:space:]]*:/ && line ~ /namespaces?/) { rbac_rule = 1; namespace_object = 1 }
    }
    END { flush(); exit bad ? 0 : 1 }
  ' "$manifest"
}

preserve_render_has_workload_hook() {
  awk '
    function flush() { if (hook && kind ~ /^(Job|Pod|Deployment|StatefulSet|DaemonSet|ReplicaSet|CronJob)$/) bad=1 }
    function reset() { hook=0; kind="" }
    BEGIN { reset() }
    /^---[[:space:]]*$/ { flush(); reset(); next }
    /^kind:[[:space:]]*/ { line=$0; sub(/^kind:[[:space:]]*/, "", line); kind=line; gsub(/["\047[:space:]]/, "", kind) }
    /helm\.sh\/hook/ { hook=1 }
    END { flush(); exit bad ? 0 : 1 }
  ' "$1"
}

preserve_resolve_rendered_scopes() {
  local manifest="$1" api_version kind group version found namespaced
  while IFS='|' read -r api_version kind; do
    [ -z "$api_version$kind" ] && continue
    case "$api_version" in
      */*) group="${api_version%%/*}"; version="${api_version#*/}" ;;
      *) group=""; version="$api_version" ;;
    esac
    found=0
    while IFS=$'\t' read -r discovered_version discovered_kind discovered_namespaced; do
      [ "$discovered_kind" = "$kind" ] || continue
      [ "$discovered_version" = "$api_version" ] || continue
      found=1
      if [ "$discovered_namespaced" != "true" ]; then
        echo "Preserve-existing preflight rejected cluster-scoped rendered GVK $api_version/$kind." >&2
        return 1
      fi
    done < <(kubectl api-resources --verbs=get,list -o wide 2>/dev/null | awk '
      { ns=""; for (i=1;i<=NF;i++) if ($i=="true" || $i=="false") { ns=$i; if (i>1 && i<NF) print $(i-1) "\t" $(i+1) "\t" ns; break } }
    ') || return 1
    if [ "$found" -ne 1 ]; then
      echo "Preserve-existing preflight could not resolve rendered GVK $api_version/$kind through discovery." >&2
      return 1
    fi
  done < <(awk '/^apiVersion:[[:space:]]*/ { av=$0; sub(/^apiVersion:[[:space:]]*/, "", av); gsub(/["\047[:space:]]/, "", av) } /^kind:[[:space:]]*/ { k=$0; sub(/^kind:[[:space:]]*/, "", k); gsub(/["\047[:space:]]/, "", k); if (av!=""&&k!="") print av "|" k; av=""; k="" }' "$manifest" | sort -u)
}

preserve_is_cluster_scoped_kind() {
  case "${1,,}" in
    namespace|node|persistentvolume|customresourcedefinition|mutatingwebhookconfiguration|validatingwebhookconfiguration|validatingadmissionpolicy|validatingadmissionpolicybinding|storageclass|priorityclass|clusterrole|clusterrolebinding|apiservice|runtimeclass|podsecuritypolicy|volumeattachment|csidriver|csinode|ingressclass|gatewayclass|flowschema|prioritylevelconfiguration) return 0 ;;
    *) return 1 ;;
  esac
}

preserve_preflight_identities() {
  local identities="$1" kind name namespace hook uid
  while IFS='|' read -r kind name namespace hook; do
    [ -z "$kind$name$namespace$hook" ] && continue
    if [ "$kind" = "INVALID" ]; then
      echo "Preserve-existing preflight rejected a rendered object without an explicit kind and name." >&2
      return 1
    fi
    case "$kind" in *[!A-Za-z0-9.-]*) echo "Preserve-existing preflight rejected an unsafe rendered kind." >&2; return 1 ;; esac
    case "$name" in ''|*[!A-Za-z0-9._-]*) echo "Preserve-existing preflight rejected an unsafe rendered object name." >&2; return 1 ;; esac
    if [ "${kind,,}" = "namespace" ]; then
      echo "Preserve-existing preflight rejected a rendered Namespace object." >&2
      return 1
    fi
    if preserve_is_cluster_scoped_kind "$kind"; then
      echo "Preserve-existing preflight rejected a cluster-scoped rendered object." >&2
      return 1
    fi
    namespace="${namespace:-$NS}"
    if [ "$namespace" != "$NS" ]; then
      echo "Preserve-existing preflight rejected an object outside the attested namespace." >&2
      return 1
    fi
    uid="$(preserve_object_uid "$kind" "$name" "$namespace")" || {
      echo "Preserve-existing preflight could not prove a rendered object name is free." >&2
      return 1
    }
    if [ -n "$uid" ]; then
      echo "Preserve-existing preflight found a conflicting resource." >&2
      return 1
    fi
  done <"$identities"
}

preserve_capture_owned_uids() {
  local identities="$1" kind name namespace hook uid
  : >"$STATE_DIR/owned-uids"
  while IFS='|' read -r kind name namespace hook; do
    [ -z "$kind" ] && continue
    namespace="${namespace:-$NS}"
    uid="$(preserve_object_uid "$kind" "$name" "$namespace")" || return 1
    if [ -z "$uid" ]; then
      [ "$hook" = "1" ] && continue
      return 1
    fi
    case "$uid" in *'|'*|*$'\n'*|*$'\r'*) return 1 ;; esac
    printf '%s|%s|%s|%s\n' "$kind" "$name" "$namespace" "$uid" >>"$STATE_DIR/owned-uids"
  done <"$identities"
}

preserve_verify_owned_uids() {
  local kind name namespace expected_uid actual_uid
  [ -f "$STATE_DIR/owned-uids" ] || return 0
  while IFS='|' read -r kind name namespace expected_uid; do
    [ -z "$kind" ] && continue
    actual_uid="$(preserve_object_uid "$kind" "$name" "$namespace")" || return 1
    [ -n "$actual_uid" ] && [ "$actual_uid" = "$expected_uid" ] || return 1
  done <"$STATE_DIR/owned-uids"
}

preserve_verify_owned_absent() {
  local kind name namespace expected_uid actual_uid
  [ -f "$STATE_DIR/owned-uids" ] || return 0
  while IFS='|' read -r kind name namespace expected_uid; do
    [ -z "$kind" ] && continue
    actual_uid="$(preserve_object_uid "$kind" "$name" "$namespace")" || return 1
    if [ -n "$actual_uid" ]; then
      echo "Preserve-existing cleanup found a release-owned resource after uninstall." >&2
      return 1
    fi
  done <"$STATE_DIR/owned-uids"
}

preserve_remove_state() {
  rm -f \
    "$STATE_DIR/namespace" "$STATE_DIR/release" "$STATE_DIR/namespace-uid" \
    "$STATE_DIR/release-storage-kind" "$STATE_DIR/release-storage-uid" \
    "$STATE_DIR/rendered-identities" "$STATE_DIR/owned-uids" \
    "$STATE_DIR/adjacent-before" "$STATE_DIR/adjacent-before.dynamic" \
    "$STATE_DIR/adjacent-after" "$STATE_DIR/adjacent-after.dynamic" \
    "$STATE_DIR/template.log" "$STATE_DIR/install.log" "$STATE_DIR/uninstall.log" \
    "$STATE_DIR/status.log" \
    "$STATE_DIR/uninstall-complete" "$STATE_DIR/port-forward.pids"
  if [ -d "$STATE_DIR" ]; then
    if find "$STATE_DIR" -mindepth 1 ! -name active -print -quit | grep -q .; then
      echo "Preserve-existing cleanup retained unexpected harness evidence; refusing to report completion." >&2
      return 1
    fi
    rm -f "$ACTIVE_FILE"
    if ! rmdir "$STATE_DIR" 2>/dev/null; then
      : >"$ACTIVE_FILE"
      echo "Preserve-existing cleanup retained its ownership marker after a state-directory race." >&2
      return 1
    fi
  fi
}

preserve_cleanup() {
  local actual_namespace_uid storage_kind actual_release_uid after_snapshot cleanup_complete
  stop_forwards
  [ -f "$ACTIVE_FILE" ] || return 0

  [ -s "$STATE_DIR/namespace" ] && [ -s "$STATE_DIR/release" ] && [ -s "$STATE_DIR/namespace-uid" ] && [ -f "$STATE_DIR/adjacent-before" ] || {
    echo "Preserve-existing cleanup refused an incomplete ownership record." >&2
    return 1
  }
  [ "$(<"$STATE_DIR/namespace")" = "$NS" ] && [ "$(<"$STATE_DIR/release")" = "$REL" ] || {
    echo "Preserve-existing cleanup refused an ownership record for a different target." >&2
    return 1
  }
  if [ -n "${E2E_EXPECTED_NAMESPACE_UID:-}" ] && [ "$E2E_EXPECTED_NAMESPACE_UID" != "$(<"$STATE_DIR/namespace-uid")" ]; then
    echo "Preserve-existing cleanup refused a changed namespace attestation." >&2
    return 1
  fi

  actual_namespace_uid="$(kubectl get namespace "$NS" -o 'jsonpath={.metadata.uid}' 2>/dev/null)" || {
    echo "Preserve-existing cleanup refused because namespace identity could not be verified." >&2
    return 1
  }
  [ -n "$actual_namespace_uid" ] && [ "$actual_namespace_uid" = "$(<"$STATE_DIR/namespace-uid")" ] || {
    echo "Preserve-existing cleanup refused because namespace identity changed." >&2
    return 1
  }

  local status_output status_result
  status_output="$STATE_DIR/status.log"
  if helm status "$REL" -n "$NS" >"$status_output" 2>&1; then
    status_result=0
  else
    status_result=$?
    if [ -s "$status_output" ] && ! grep -Eiq '(^|[[:space:]])release([:"[:space:]]|$).*not[[:space:]-]*found|release[[:space:]].*not[[:space:]-]*found' "$status_output"; then
      preserve_release_storage || true
      echo "Preserve-existing cleanup could not establish Helm release absence; status failed with an ambiguous transport/auth/server error. Evidence remains for retry." >&2
      return 1
    fi
    preserve_verify_owned_absent || return 1
    after_snapshot="$STATE_DIR/adjacent-after"
    preserve_snapshot_adjacent "$after_snapshot" || return 1
    comm -23 "$STATE_DIR/adjacent-before" "$after_snapshot" | grep -q . && {
      echo "Preserve-existing cleanup found changed adjacent resource UIDs." >&2
      return 1
    }
    preserve_remove_state || return 1
    return 0
  fi

  if [ ! -s "$STATE_DIR/release-storage-kind" ] || [ ! -s "$STATE_DIR/release-storage-uid" ]; then
    preserve_release_storage || {
      echo "Preserve-existing cleanup refused an unverified Helm release." >&2
      return 1
    }
  fi
  storage_kind="$(<"$STATE_DIR/release-storage-kind")"
  actual_release_uid="$(preserve_object_uid "$storage_kind" "sh.helm.release.v1.${REL}.v1" "$NS")" || return 1
  [ -n "$actual_release_uid" ] && [ "$actual_release_uid" = "$(<"$STATE_DIR/release-storage-uid")" ] || {
    echo "Preserve-existing cleanup refused because Helm release identity changed." >&2
    return 1
  }
  preserve_verify_owned_uids || {
    echo "Preserve-existing cleanup refused because an owned resource UID changed." >&2
    return 1
  }

  cleanup_complete="$STATE_DIR/uninstall-complete"
  if ! helm uninstall "$REL" -n "$NS" --ignore-not-found --wait --timeout 15m >"$STATE_DIR/uninstall.log" 2>&1; then
    echo "Preserve-existing Helm cleanup failed; details remain in the private harness state directory." >&2
    return 1
  fi
  preserve_verify_owned_absent || return 1
  : >"$cleanup_complete"

  after_snapshot="$STATE_DIR/adjacent-after"
  preserve_snapshot_adjacent "$after_snapshot" || return 1
  comm -23 "$STATE_DIR/adjacent-before" "$after_snapshot" | grep -q . && {
    echo "Preserve-existing cleanup found changed adjacent resource UIDs." >&2
    return 1
  }
  rm -f "$ACTIVE_FILE"
  preserve_remove_state || return 1
  echo ">> Removed the exact E2E Helm release; the attested namespace and adjacent resources were preserved."
}

PRESERVE_UP_ARMED=0
PRESERVE_MANIFEST=""
preserve_up_exit() {
  local result=$? cleanup_result=0
  trap - EXIT INT TERM
  if [ "$PRESERVE_UP_ARMED" -eq 1 ]; then
    preserve_cleanup || cleanup_result=$?
  else
    rm -f "$STATE_DIR/template.log" "$STATE_DIR/rendered-identities" \
      "$STATE_DIR/adjacent-before" "$STATE_DIR/adjacent-before.dynamic"
  fi
  [ -z "$PRESERVE_MANIFEST" ] || rm -f "$PRESERVE_MANIFEST"
  if [ "$result" -eq 0 ] && [ "$cleanup_result" -ne 0 ]; then result=$cleanup_result; fi
  exit "$result"
}

preserve_up() {
  local actual_uid releases chart identities install_help values=() rollback_flag=()
  umask 077
  PRESERVE_UP_ARMED=0
  trap preserve_up_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  [ -n "${E2E_EXPECTED_NAMESPACE_UID:-}" ] || {
    echo "E2E_EXPECTED_NAMESPACE_UID is mandatory with E2E_NAMESPACE_MODE=preserve-existing." >&2
    return 2
  }
  case "$E2E_EXPECTED_NAMESPACE_UID" in *[!A-Za-z0-9._:-]*) echo "E2E_EXPECTED_NAMESPACE_UID is malformed." >&2; return 2 ;; esac
  [ -z "${DEPLOY_CMD:-}" ] || {
    echo "DEPLOY_CMD is not permitted with preserve-existing; only the preflighted Helm install is allowed." >&2
    return 2
  }
  require helm
  if [ -L "$STATE_DIR" ] || { [ -e "$STATE_DIR" ] && [ ! -d "$STATE_DIR" ]; } || \
    { [ -d "$STATE_DIR" ] && find "$STATE_DIR" -mindepth 1 -print -quit | grep -q .; }; then
    echo "The preserve-existing harness state directory is not empty; refusing to reuse it." >&2
    return 2
  fi
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  [ ! -e "$ACTIVE_FILE" ] || {
    echo "An active preserve-existing ownership record already exists; refusing another run." >&2
    return 2
  }

  actual_uid="$(kubectl get namespace "$NS" -o 'jsonpath={.metadata.uid}' 2>/dev/null)" || {
    echo "The preserve-existing namespace is absent or unreadable." >&2
    return 2
  }
  [ -n "$actual_uid" ] && [ "$actual_uid" = "$E2E_EXPECTED_NAMESPACE_UID" ] || {
    echo "The preserve-existing namespace UID does not match its attestation." >&2
    return 2
  }

  releases="$(helm list -n "$NS" -o json 2>/dev/null)" || {
    echo "Could not prove that the preserve-existing namespace has no Helm releases." >&2
    return 2
  }
  releases="${releases//[[:space:]]/}"
  [ "$releases" = "[]" ] || {
    echo "Preserve-existing requires a namespace with no existing Helm releases." >&2
    return 2
  }

  chart="$(find_chart)" || {
    echo "No Helm chart found. Set E2E_HELM_CHART and safe values for preserve-existing mode." >&2
    return 2
  }
  case "$chart" in -*|*$'\n'*|*$'\r'*) echo "E2E_HELM_CHART is not a safe chart reference." >&2; return 2 ;; esac
  if [ -n "${E2E_HELM_VALUES:-}" ]; then values=(-f "$E2E_HELM_VALUES"); fi
  install_help="$(helm install --help 2>/dev/null)" || {
    echo "Could not inspect Helm's failure-rollback capability." >&2
    return 2
  }
  if grep -q -- '--rollback-on-failure' <<<"$install_help"; then
    rollback_flag=(--rollback-on-failure)
  elif grep -q -- '--atomic' <<<"$install_help"; then
    rollback_flag=(--atomic)
  else
    echo "Helm does not expose a supported install failure-rollback flag." >&2
    return 2
  fi
  PRESERVE_MANIFEST="$(mktemp "${TMPDIR:-/tmp}/falcone-preserve-render.XXXXXX")"
  identities="$STATE_DIR/rendered-identities"
  if ! helm template "$REL" "$chart" "${values[@]}" --namespace "$NS" --include-crds --skip-schema-validation >"$PRESERVE_MANIFEST" 2>"$STATE_DIR/template.log"; then
    echo "Preserve-existing Helm render failed; no cluster mutation was attempted." >&2
    return 2
  fi
  preserve_render_identities "$PRESERVE_MANIFEST" "$identities"
  preserve_resolve_rendered_scopes "$PRESERVE_MANIFEST" || return 2
  if preserve_render_has_workload_hook "$PRESERVE_MANIFEST"; then
    echo "Preserve-existing preflight rejected a Helm workload hook." >&2
    return 2
  fi
  if preserve_render_has_namespace_mutating_hook "$PRESERVE_MANIFEST"; then
    echo "Preserve-existing preflight rejected a namespace-mutating Helm hook." >&2
    return 2
  fi
  preserve_preflight_identities "$identities" || return 2
  preserve_snapshot_adjacent "$STATE_DIR/adjacent-before" || {
    echo "Could not snapshot adjacent resource UIDs before installation." >&2
    return 2
  }

  printf '%s' "$NS" >"$STATE_DIR/namespace"
  printf '%s' "$REL" >"$STATE_DIR/release"
  printf '%s' "$actual_uid" >"$STATE_DIR/namespace-uid"
  : >"$ACTIVE_FILE"
  PRESERVE_UP_ARMED=1

  echo ">> Installing one preflighted Helm release into the attested existing namespace ..."
  if ! helm install "$REL" "$chart" "${values[@]}" -n "$NS" "${rollback_flag[@]}" --skip-schema-validation --server-side=false --wait --timeout 15m >"$STATE_DIR/install.log" 2>&1; then
    preserve_release_storage || true
    echo "Preserve-existing Helm install failed; trap cleanup is removing any verified release." >&2
    return 1
  fi
  preserve_release_storage || {
    echo "Installed Helm release storage could not be UID-attested; cleanup will fail closed." >&2
    return 1
  }
  preserve_capture_owned_uids "$identities" || {
    echo "Installed resource UIDs could not be captured; cleanup will use the release UID and fail closed." >&2
    return 1
  }

  healthy
  echo ">> Port-forwarding front + back ..."
  stop_forwards; : >"$PIDFILE"
  for f in $FWD; do
    svc="${f%%:*}"; rest="${f#*:}"; lport="${rest%%:*}"; rport="${rest##*:}"
    kubectl port-forward "$svc" "$lport:$rport" -n "$NS" >/dev/null 2>&1 &
    echo $! >>"$PIDFILE"; disown 2>/dev/null || true
  done
  sleep 3
  smoke
  echo "E2E_BASE_URL=$BASE"
  echo ">> Stack up and healthy in the attested existing namespace."

  PRESERVE_UP_ARMED=0
  trap - EXIT INT TERM
  rm -f "$PRESERVE_MANIFEST"
  PRESERVE_MANIFEST=""
}

case "${1:-up}" in
  up)
    require kubectl; guard
    if [ -f "$ACTIVE_FILE" ] && [ "$MODE" != "preserve-existing" ]; then
      echo "A preserve-existing ownership record is active; refusing the ephemeral namespace lifecycle." >&2
      exit 2
    fi
    if [ "$MODE" = "preserve-existing" ]; then
      preserve_up
      exit 0
    fi
    echo ">> Recreating namespace '$NS' (clean slate) ..."
    kubectl delete namespace "$NS" --ignore-not-found --wait=true
    kubectl create namespace "$NS"

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
    # Temporal's persistence is configured to use these same credentials in e2e.
    echo ">> Creating pre-install secrets in '$NS' ..."
    kubectl create secret generic in-falcone-postgresql \
      --from-literal=POSTGRESQL_USERNAME=falcone \
      --from-literal=POSTGRESQL_PASSWORD=falcone \
      --from-literal=POSTGRESQL_POSTGRES_PASSWORD=falcone \
      --from-literal=POSTGRESQL_DATABASE=in_falcone \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
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
        # No Temporal: standard helm install with hooks.
        # --skip-schema-validation: in-falcone chart has strict JSON-schema constraints that
        # reject unknown/overridden keys even in valid e2e overlay combinations (known quirk).
        helm upgrade --install --skip-schema-validation --server-side=false "$REL" "$CHART" -n "$NS" $VALUES_FLAG --wait --timeout 15m
      fi
    fi
    # Clean up SeaweedFS overlay temp file if it was created.
    [ -n "${SEAWEEDFS_OVERLAY:-}" ] && rm -f "$SEAWEEDFS_OVERLAY" || true
    healthy
    echo ">> Port-forwarding front + back ..."
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
    if [ "$MODE" = "preserve-existing" ] || [ -f "$ACTIVE_FILE" ]; then
      require helm
      preserve_cleanup
      exit 0
    fi
    stop_forwards
    # Deletes the whole ephemeral namespace — the FerretDB gateway (Deployment) and DocumentDB
    # engine (StatefulSet + PVC) are namespace-scoped and torn down with it, same as every other
    # component (add-ferretdb-document-store-e2e #464, task 8.4).
    kubectl delete namespace "$NS" --ignore-not-found --wait=false
    echo ">> Namespace '$NS' deleted (all pods removed). Cluster left intact."
    ;;
  status)
    kubectl get pods -n "$NS" 2>/dev/null || echo "namespace '$NS' not present"
    ;;
  *) echo "usage: stack.sh up|down|status" >&2; exit 1;;
esac
