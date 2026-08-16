#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DELIVERY_STATE_ROOT="${DELIVERY_STATE_ROOT:-$HERMES_HOME/delivery-state}"

log() { printf '[%s] %s\n' "${HDEPLOY_PROJECT:-delivery}" "$*" >&2; }
die() { local message="$1" code="${2:-1}"; log "$message"; exit "$code"; }
blocked() { printf 'BLOCKED_DELIVERY stage=%s reason=%s\n' "$1" "$2" >&2; exit 78; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || blocked preflight "missing_command_$1"; }
require_file() { [[ -f "$1" ]] || blocked preflight "missing_file_$1"; }
require_dir() { [[ -d "$1" ]] || blocked preflight "missing_directory_$1"; }
expand_home() { local p="$1"; printf '%s\n' "${p/#\~/$HOME}"; }

sanitize_token() {
  local value="${1:-}" max="${2:-96}"
  value="$(printf '%s' "$value" | LC_ALL=C tr -c 'A-Za-z0-9._-' '-')"
  while [[ "$value" == *--* ]]; do value="${value//--/-}"; done
  value="${value#-}"; value="${value%-}"
  [[ -n "$value" ]] || value="unknown"
  printf '%.*s\n' "$max" "$value"
}

load_adapter_env() {
  local project="$1"
  local f="$HERMES_HOME/project-adapters/$project/adapter.env"
  [[ -f "$f" ]] || blocked preflight "missing_adapter_env_$f"
  # shellcheck disable=SC1090
  source "$f"
}

json_get() {
  local f="$1" filter="$2"
  jq -er "$filter" "$f"
}

json_get_optional() {
  local f="$1" filter="$2"
  jq -r "$filter // empty" "$f"
}

json_update() {
  local f="$1" filter="$2"; shift 2
  local tmp
  tmp="$(mktemp "${f}.tmp.XXXXXX")"
  jq "$@" "$filter" "$f" >"$tmp"
  mv "$tmp" "$f"
}

state_dir_for() {
  local project="$1" issue="$2"
  local d="$DELIVERY_STATE_ROOT/$project/issue-$(sanitize_token "$issue")"
  install -d -m 700 "$d"
  printf '%s\n' "$d"
}

wait_gh_run_id() {
  local repo="$1" workflow="$2" commit="$3" created_after="${4:-1970-01-01T00:00:00Z}" event="${5:-}"
  local run_id="" i
  local args=(run list --repo "$repo" --workflow "$workflow" --commit "$commit" --limit 20)
  [[ -z "$event" ]] || args+=(--event "$event")
  for i in $(seq 1 60); do
    run_id="$(gh "${args[@]}" \
      --json databaseId,createdAt,status,conclusion,headSha \
      --jq '[.[] | select(.createdAt >= "'"$created_after"'")][0].databaseId // empty' 2>/dev/null || true)"
    [[ -n "$run_id" ]] && break
    sleep 5
  done
  [[ -n "$run_id" ]] || blocked artifact "workflow_run_not_found_${repo}_${workflow}_${commit}"
  printf '%s\n' "$run_id"
}

latest_gh_run_id() {
  local repo="$1" workflow="$2" commit="$3" event="${4:-}"
  local args=(run list --repo "$repo" --workflow "$workflow" --commit "$commit" --limit 20)
  [[ -z "$event" ]] || args+=(--event "$event")
  gh "${args[@]}" --json databaseId,createdAt \
    --jq 'sort_by(.createdAt) | reverse | .[0].databaseId // empty'
}

wait_latest_gh_run_id() {
  local repo="$1" workflow="$2" commit="$3" event="${4:-}" run_id="" i
  for i in $(seq 1 60); do
    run_id="$(latest_gh_run_id "$repo" "$workflow" "$commit" "$event" 2>/dev/null || true)"
    [[ -n "$run_id" ]] && { printf '%s\n' "$run_id"; return 0; }
    sleep 5
  done
  blocked artifact "workflow_run_not_found_${repo}_${workflow}_${commit}"
}

rerun_gh_run_if_failed() {
  local repo="$1" run_id="$2" conclusion
  conclusion="$(gh run view "$run_id" --repo "$repo" --json conclusion --jq '.conclusion // empty' 2>/dev/null || true)"
  case "$conclusion" in
    failure|cancelled|timed_out|action_required|startup_failure)
      log "Re-running failed GitHub Actions run $run_id ($repo, conclusion=$conclusion)"
      gh run rerun "$run_id" --repo "$repo" >/dev/null
      ;;
  esac
}

watch_gh_run_id() {
  local repo="$1" run_id="$2"
  [[ "$run_id" =~ ^[0-9]+$ ]] || blocked artifact "invalid_workflow_run_id_$run_id"
  log "Watching GitHub Actions run $run_id ($repo)"
  if gh run watch "$run_id" --repo "$repo" --exit-status >&2; then
    return 0
  fi
  local conclusion
  conclusion="$(gh run view "$run_id" --repo "$repo" --json conclusion --jq '.conclusion // empty' 2>/dev/null || true)"
  blocked artifact "workflow_run_${run_id}_${conclusion:-failed}"
}

wait_gh_run() {
  local repo="$1" workflow="$2" commit="$3" created_after="${4:-1970-01-01T00:00:00Z}"
  local run_id
  run_id="$(wait_gh_run_id "$repo" "$workflow" "$commit" "$created_after")"
  watch_gh_run_id "$repo" "$run_id"
  printf '%s\n' "$run_id"
}

resolve_github_ref_commit() {
  local repo="$1" ref="$2"
  gh api "repos/$repo/commits/$ref" --jq '.sha'
}

latest_release_patch_bump() {
  local repo="$1"
  {
    gh release list --repo "$repo" --limit 100 --json tagName --jq '.[].tagName' 2>/dev/null || true
    gh api --paginate "repos/$repo/tags?per_page=100" --jq '.[].name' 2>/dev/null || true
  } | python3 -c '
import re,sys
versions=set()
for raw in sys.stdin:
    value=raw.strip()
    m=re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", value)
    if m:
        versions.add(tuple(map(int,m.groups())))
major,minor,patch=max(versions, default=(0,0,0))
print(f"v{major}.{minor}.{patch+1}")
'
}

inspect_image_json_if_available() {
  local ref="$1"
  require_cmd skopeo
  local args=(inspect)
  if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
    args+=(--creds "${GHCR_USERNAME}:${GHCR_TOKEN}")
  fi
  skopeo "${args[@]}" "docker://$ref" 2>/dev/null
}

image_digest_if_available() {
  local ref="$1" metadata digest
  metadata="$(inspect_image_json_if_available "$ref")" || return 1
  digest="$(jq -r '.Digest // empty' <<<"$metadata")"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '%s\n' "$digest"
}

image_revision_from_metadata() {
  local metadata="$1"
  jq -r '.Labels["org.opencontainers.image.revision"] // empty' <<<"$metadata"
}

resolve_image_digest() {
  local ref="$1" digest
  digest="$(image_digest_if_available "$ref" || true)"
  [[ -n "$digest" ]] || blocked artifact "digest_unavailable_for_$(sanitize_token "$ref" 140)"
  printf '%s\n' "$digest"
}

assert_no_placeholders() {
  local name value
  while (( $# >= 2 )); do
    name="$1"; value="$2"; shift 2
    [[ -n "$value" ]] || blocked preflight "missing_$name"
    [[ "$value" != *REPLACE* && "$value" != *CHANGEME* && "$value" != *example.invalid* ]] \
      || blocked preflight "placeholder_$name"
  done
}

safe_git_identity() {
  git config --global user.name >/dev/null 2>&1 || git config --global user.name "Hermes Engineering Agent"
  git config --global user.email >/dev/null 2>&1 || git config --global user.email "hermes-agent@users.noreply.github.com"
}

wait_k8s_workloads() {
  local context="$1" namespace="$2" timeout="${3:-15m}"
  local names
  names="$(kubectl --context "$context" -n "$namespace" get deployment -o name 2>/dev/null || true)"
  if [[ -n "$names" ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      kubectl --context "$context" -n "$namespace" rollout status "$name" --timeout="$timeout"
    done <<<"$names"
  fi
  names="$(kubectl --context "$context" -n "$namespace" get statefulset -o name 2>/dev/null || true)"
  if [[ -n "$names" ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      kubectl --context "$context" -n "$namespace" rollout status "$name" --timeout="$timeout"
    done <<<"$names"
  fi
}

wait_argocd_application() {
  local context="$1" namespace="$2" app="$3" timeout_seconds="${4:-1800}"
  local start now sync health phase
  start="$(date +%s)"
  kubectl --context "$context" -n "$namespace" annotate application "$app" \
    argocd.argoproj.io/refresh=hard --overwrite >/dev/null
  while true; do
    sync="$(kubectl --context "$context" -n "$namespace" get application "$app" -o jsonpath='{.status.sync.status}' 2>/dev/null || true)"
    health="$(kubectl --context "$context" -n "$namespace" get application "$app" -o jsonpath='{.status.health.status}' 2>/dev/null || true)"
    phase="$(kubectl --context "$context" -n "$namespace" get application "$app" -o jsonpath='{.status.operationState.phase}' 2>/dev/null || true)"
    log "Argo CD app=$app sync=${sync:-unknown} health=${health:-unknown} operation=${phase:-none}"
    if [[ "$sync" == "Synced" && "$health" == "Healthy" && "$phase" != "Failed" && "$phase" != "Error" ]]; then
      return 0
    fi
    [[ "$phase" != "Failed" && "$phase" != "Error" ]] || blocked argocd "application_operation_$phase"
    now="$(date +%s)"
    (( now - start < timeout_seconds )) || blocked argocd application_wait_timeout
    sleep 10
  done
}


wait_argocd_application_revisions() {
  local context="$1" namespace="$2" app="$3" timeout_seconds="$4"
  shift 4
  local expected=("$@")
  local start now payload sync health phase revisions expected_ref found all_found
  start="$(date +%s)"
  kubectl --context "$context" -n "$namespace" annotate application "$app" \
    argocd.argoproj.io/refresh=hard --overwrite >/dev/null
  while true; do
    payload="$(kubectl --context "$context" -n "$namespace" get application "$app" -o json 2>/dev/null || true)"
    [[ -n "$payload" ]] || payload='{}'
    sync="$(jq -r '.status.sync.status // empty' <<<"$payload" 2>/dev/null || true)"
    health="$(jq -r '.status.health.status // empty' <<<"$payload" 2>/dev/null || true)"
    phase="$(jq -r '.status.operationState.phase // empty' <<<"$payload" 2>/dev/null || true)"
    revisions="$(jq -r '[.status.sync.revisions[]?, .status.sync.revision?] | map(select(. != null and . != "")) | unique | .[]' <<<"$payload" 2>/dev/null || true)"
    all_found=true
    for expected_ref in "${expected[@]}"; do
      [[ -n "$expected_ref" ]] || continue
      found=false
      while IFS= read -r revision; do
        [[ "$revision" == "$expected_ref" ]] && { found=true; break; }
      done <<<"$revisions"
      [[ "$found" == "true" ]] || { all_found=false; break; }
    done
    log "Argo CD app=$app sync=${sync:-unknown} health=${health:-unknown} operation=${phase:-none} revisions=$(tr '\n' ',' <<<"$revisions" | sed 's/,$//')"
    if [[ "$sync" == "Synced" && "$health" == "Healthy" && "$phase" != "Failed" && "$phase" != "Error" && "$all_found" == "true" ]]; then
      return 0
    fi
    [[ "$phase" != "Failed" && "$phase" != "Error" ]] || blocked argocd "application_operation_$phase"
    now="$(date +%s)"
    (( now - start < timeout_seconds )) || blocked argocd application_revision_wait_timeout
    sleep 10
  done
}

wait_pr_checks() {
  local repo="$1" pr="$2" timeout_seconds="${3:-3600}"
  local start now payload count pending failed
  start="$(date +%s)"
  while true; do
    payload="$(gh pr view "$pr" --repo "$repo" --json statusCheckRollup,mergeStateStatus,isDraft)"
    count="$(jq '.statusCheckRollup | length' <<<"$payload")"
    failed="$(jq '[.statusCheckRollup[]? | select((.conclusion // "") == "FAILURE" or (.conclusion // "") == "CANCELLED" or (.conclusion // "") == "TIMED_OUT" or (.conclusion // "") == "ACTION_REQUIRED" or (.conclusion // "") == "STARTUP_FAILURE" or (.state // "") == "FAILURE" or (.state // "") == "ERROR")] | length' <<<"$payload")"
    pending="$(jq '[.statusCheckRollup[]? | select((.status // "") == "QUEUED" or (.status // "") == "IN_PROGRESS" or (.status // "") == "PENDING" or (.state // "") == "PENDING" or (.state // "") == "EXPECTED")] | length' <<<"$payload")"
    (( failed == 0 )) || blocked ci "pull_request_${pr}_checks_failed"
    now="$(date +%s)"
    if (( count == 0 )); then
      # GitHub can take several seconds to attach check suites after PR creation.
      # After a grace period, zero checks means this repository has no checks for
      # the PR; branch protection is still enforced by the merge operation.
      (( now - start >= 45 )) && return 0
    elif (( pending == 0 )); then
      return 0
    fi
    (( now - start < timeout_seconds )) || blocked ci "pull_request_${pr}_checks_timeout"
    sleep 15
  done
}

find_or_create_pr() {
  local repo="$1" base="$2" head="$3" title="$4" body_file="$5" draft="${6:-false}"
  local pr
  pr="$(gh pr list --repo "$repo" --state open --head "$head" --json number --jq '.[0].number // empty')"
  if [[ -z "$pr" ]]; then
    local args=(pr create --repo "$repo" --base "$base" --head "$head" --title "$title" --body-file "$body_file")
    [[ "$draft" == "true" ]] && args+=(--draft)
    gh "${args[@]}" >/dev/null
    pr="$(gh pr list --repo "$repo" --state open --head "$head" --json number --jq '.[0].number')"
  fi
  printf '%s\n' "$pr"
}

merge_pr_and_wait() {
  local repo="$1" pr="$2" method="${3:-squash}" timeout_seconds="${4:-1800}"
  local flag="--squash"
  case "$method" in
    squash) flag="--squash" ;;
    merge) flag="--merge" ;;
    rebase) flag="--rebase" ;;
    *) blocked merge "unsupported_merge_method_$method" ;;
  esac
  gh pr merge "$pr" --repo "$repo" "$flag" --delete-branch || blocked merge "pull_request_${pr}_merge_failed"
  local start now merged state
  start="$(date +%s)"
  while true; do
    merged="$(gh pr view "$pr" --repo "$repo" --json mergedAt --jq '.mergedAt // empty')"
    [[ -n "$merged" ]] && return 0
    state="$(gh pr view "$pr" --repo "$repo" --json state --jq '.state')"
    [[ "$state" != "CLOSED" ]] || blocked merge "pull_request_${pr}_closed_without_merge"
    now="$(date +%s)"
    (( now - start < timeout_seconds )) || blocked merge "pull_request_${pr}_merge_timeout"
    sleep 10
  done
}

OPENSHIFT_KUBECONFIG=""
OPENSHIFT_LOGIN_HINT="hcluster-login llmwiki login"

init_openshift_session() {
  OPENSHIFT_KUBECONFIG="$(expand_home "$1")"
  OPENSHIFT_LOGIN_HINT="${2:-hcluster-login llmwiki login}"
  require_cmd oc
  if [[ ! -f "$OPENSHIFT_KUBECONFIG" ]] || ! KUBECONFIG="$OPENSHIFT_KUBECONFIG" oc whoami >/dev/null 2>&1; then
    printf 'BLOCKED_AUTH_OPENSHIFT\nRun: %s\n' "$OPENSHIFT_LOGIN_HINT" >&2
    exit 79
  fi
  export KUBECONFIG="$OPENSHIFT_KUBECONFIG"
}

ocx() {
  [[ -n "$OPENSHIFT_KUBECONFIG" ]] || die "init_openshift_session must be called before ocx" 70
  local rc
  if KUBECONFIG="$OPENSHIFT_KUBECONFIG" command oc "$@"; then
    return 0
  else
    rc=$?
  fi
  if ! KUBECONFIG="$OPENSHIFT_KUBECONFIG" command oc whoami >/dev/null 2>&1; then
    printf 'BLOCKED_AUTH_OPENSHIFT\nRun: %s\n' "$OPENSHIFT_LOGIN_HINT" >&2
    exit 79
  fi
  return "$rc"
}
