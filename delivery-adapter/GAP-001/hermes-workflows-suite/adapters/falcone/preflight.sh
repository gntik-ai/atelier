#!/usr/bin/env bash
set -euo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/lib.sh
source "$D/../common/lib.sh"
# shellcheck source=lib-migration-waiver.sh
source "$D/lib-migration-waiver.sh"
load_adapter_env falcone

for c in git gh jq kubectl helm skopeo python3; do require_cmd "$c"; done
FALCONE_SOURCE_REPO_DIR="$(expand_home "$FALCONE_SOURCE_REPO_DIR")"
FALCONE_CHART_REPO_DIR="$(expand_home "$FALCONE_CHART_REPO_DIR")"
require_dir "$FALCONE_SOURCE_REPO_DIR/.git"
require_dir "$FALCONE_CHART_REPO_DIR/.git"
require_file "$FALCONE_CHART_REPO_DIR/$FALCONE_CHART_RELATIVE_PATH/Chart.yaml"
require_file "$FALCONE_CHART_REPO_DIR/$FALCONE_STAGING_VALUES_RELATIVE_PATH"
assert_no_placeholders \
  FALCONE_GITHUB_REPO "$FALCONE_GITHUB_REPO" \
  FALCONE_CHART_GITHUB_REPO "$FALCONE_CHART_GITHUB_REPO" \
  FALCONE_HELM_RELEASE "$FALCONE_HELM_RELEASE" \
  FALCONE_NAMESPACE "$FALCONE_NAMESPACE" \
  FALCONE_RUNTIME_VERIFY_COMMAND "$FALCONE_RUNTIME_VERIFY_COMMAND"

gh auth status >/dev/null 2>&1 || blocked preflight gh_auth_invalid
gh repo view "$FALCONE_GITHUB_REPO" >/dev/null
gh repo view "$FALCONE_CHART_GITHUB_REPO" >/dev/null
gh workflow view "$FALCONE_RELEASE_WORKFLOW" --repo "$FALCONE_GITHUB_REPO" >/dev/null
kubectl config get-contexts "$FALCONE_CLUSTER_CONTEXT" >/dev/null 2>&1 || blocked preflight kubernetes_context_missing
kubectl --context "$FALCONE_CLUSTER_CONTEXT" cluster-info >/dev/null
kubectl --context "$FALCONE_CLUSTER_CONTEXT" get namespace "$FALCONE_NAMESPACE" >/dev/null

if helm --kube-context "$FALCONE_CLUSTER_CONTEXT" -n "$FALCONE_NAMESPACE" status "$FALCONE_HELM_RELEASE" >/dev/null 2>&1; then
  if [[ -n "${FALCONE_BACKUP_EVIDENCE_FILE:-}" ]]; then
    require_file "$FALCONE_BACKUP_EVIDENCE_FILE"
    "$D/validate-backup-evidence.sh" "$FALCONE_BACKUP_EVIDENCE_FILE" >/dev/null
    FALCONE_BACKUP_VERIFIED=true
    FALCONE_PARITY_VERIFIED=true
    FALCONE_BACKUP_REFERENCE="$(json_get "$FALCONE_BACKUP_EVIDENCE_FILE" '.backup.reference')"
    log "Validated automatic staging backup/restore/parity evidence $FALCONE_BACKUP_REFERENCE"
  fi
  if [[ "$FALCONE_BACKUP_VERIFIED" != "true" || "$FALCONE_PARITY_VERIFIED" != "true" ]]; then
    if [[ -n "${FALCONE_MIGRATION_WAIVER_FILE:-}" ]]; then
      revision_set="${FALCONE_PREFLIGHT_REVISION_SET:-}"
      assert_no_placeholders FALCONE_PREFLIGHT_REVISION_SET "$revision_set"
      require_file "$revision_set"
      chart_commit="$(json_get "$revision_set" '.repositories["falcone-charts"].commit')"
      chart_root="$(json_get "$revision_set" '.repositories["falcone-charts"].worktree_path')"
      chart_root="$(expand_home "$chart_root")"
      falcone_migration_waiver_load "$revision_set" "$chart_commit"
      log "Option-B migration waiver ${FALCONE_MIGRATION_WAIVER_ID} is valid; backup/parity remain unverified"
    else
      [[ "$FALCONE_BACKUP_VERIFIED" == "true" ]] || blocked preflight falcone_backup_not_verified
      [[ "$FALCONE_PARITY_VERIFIED" == "true" ]] || blocked preflight falcone_parity_not_verified
    fi
  else
    assert_no_placeholders FALCONE_BACKUP_REFERENCE "$FALCONE_BACKUP_REFERENCE"
  fi
  assert_no_placeholders FALCONE_CURRENT_VERSION "${FALCONE_CURRENT_VERSION:-}"
  [[ "$FALCONE_CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9._-]+)?$ ]] || blocked preflight falcone_current_version_invalid
fi

if [[ "${FALCONE_RUNTIME_VERIFY_COMMAND}" == *"hruntime-verify falcone"* ]]; then
  command -v hruntime-verify >/dev/null 2>&1 || blocked preflight missing_hruntime_verify
  hruntime-verify falcone --check >/dev/null
fi
echo "FALCONE_DELIVERY_PREFLIGHT_OK"
