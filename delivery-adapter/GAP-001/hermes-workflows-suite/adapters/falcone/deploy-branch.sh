#!/usr/bin/env bash
set -euo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$D/../common/lib.sh"
# shellcheck source=lib-migration-waiver.sh
source "$D/lib-migration-waiver.sh"
load_adapter_env falcone
REVISION_SET="${1:?Usage: deploy-branch.sh <revision-set.json>}"
require_file "$REVISION_SET"

chart_repo="$(expand_home "$FALCONE_CHART_REPO_DIR")"
require_dir "$chart_repo/.git"
chart_worktree="$(json_get_optional "$REVISION_SET" '.repositories["falcone-charts"].worktree_path')"
chart_commit="$(json_get_optional "$REVISION_SET" '.repositories["falcone-charts"].commit')"
temp_chart_worktree=""
render=""
cleanup(){
  [[ -z "$render" ]] || rm -f "$render"
  if [[ -n "$temp_chart_worktree" ]]; then
    git -C "$chart_repo" worktree remove --force "$temp_chart_worktree" >/dev/null 2>&1 || true
    rm -rf "$temp_chart_worktree"
  fi
}
trap cleanup EXIT

if [[ -n "$chart_worktree" ]]; then
  chart_root="$(expand_home "$chart_worktree")"
  require_dir "$chart_root"
  actual_chart_commit="$(git -C "$chart_root" rev-parse HEAD)"
  [[ -z "$chart_commit" || "$actual_chart_commit" == "$chart_commit" ]] \
    || blocked deploy falcone_chart_worktree_commit_mismatch
  chart_commit="$actual_chart_commit"
else
  # Even when an issue does not edit falcone-charts, deploy from an exact detached
  # commit rather than a potentially stale/dirty long-lived checkout.
  git -C "$chart_repo" fetch origin main --prune
  [[ -n "$chart_commit" ]] || chart_commit="$(git -C "$chart_repo" rev-parse origin/main)"
  git -C "$chart_repo" cat-file -e "$chart_commit^{commit}" 2>/dev/null \
    || blocked deploy falcone_chart_commit_unavailable
  install -d -m 700 "$HOME/worktrees"
  temp_chart_worktree="$(mktemp -d "$HOME/worktrees/falcone-charts-deploy.XXXXXX")"
  git -C "$chart_repo" worktree add --detach "$temp_chart_worktree" "$chart_commit" >/dev/null
  chart_root="$temp_chart_worktree"
fi

chart="$chart_root/$FALCONE_CHART_RELATIVE_PATH"
values="$chart_root/$FALCONE_STAGING_VALUES_RELATIVE_PATH"
require_file "$chart/Chart.yaml"
require_file "$values"
values_args=(-f "$values")
if [[ -n "${FALCONE_EXTRA_VALUES_FILES:-}" ]]; then
  IFS=':' read -r -a extra_values <<<"$FALCONE_EXTRA_VALUES_FILES"
  for f in "${extra_values[@]}"; do
    [[ "$f" = /* ]] || f="$chart_root/$f"
    require_file "$f"
    values_args+=(-f "$f")
  done
fi

release_exists=false
falcone_migration_waiver=false
if helm --kube-context "$FALCONE_CLUSTER_CONTEXT" -n "$FALCONE_NAMESPACE" status "$FALCONE_HELM_RELEASE" >/dev/null 2>&1; then
  release_exists=true
  assert_no_placeholders FALCONE_CURRENT_VERSION "${FALCONE_CURRENT_VERSION:-}"
  [[ "$FALCONE_CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9._-]+)?$ ]] || blocked deploy current_version_invalid
  if [[ -n "${FALCONE_BACKUP_EVIDENCE_FILE:-}" ]]; then
    require_file "$FALCONE_BACKUP_EVIDENCE_FILE"
    "$D/validate-backup-evidence.sh" "$FALCONE_BACKUP_EVIDENCE_FILE" >/dev/null
    FALCONE_BACKUP_VERIFIED=true
    FALCONE_PARITY_VERIFIED=true
    FALCONE_BACKUP_REFERENCE="$(json_get "$FALCONE_BACKUP_EVIDENCE_FILE" '.backup.reference')"
    evidence_revision="$(json_get "$FALCONE_BACKUP_EVIDENCE_FILE" '.target.helmRevision')"
    live_revision="$(helm --kube-context "$FALCONE_CLUSTER_CONTEXT" -n "$FALCONE_NAMESPACE" status "$FALCONE_HELM_RELEASE" -o json | jq -er '.version | tostring')"
    [[ "$evidence_revision" == "$live_revision" ]] || blocked deploy backup_evidence_live_revision_mismatch
    log "Using validated automatic staging backup/restore/parity evidence $FALCONE_BACKUP_REFERENCE"
  fi
  if [[ "$FALCONE_BACKUP_VERIFIED" == "true" && "$FALCONE_PARITY_VERIFIED" == "true" ]]; then
    assert_no_placeholders FALCONE_BACKUP_REFERENCE "$FALCONE_BACKUP_REFERENCE"
  elif falcone_migration_waiver_load "$REVISION_SET" "$chart_commit"; then
    falcone_migration_waiver=true
    log "Using auditable Falcone migration waiver $FALCONE_MIGRATION_WAIVER_ID; backup/parity remain unverified"
  elif [[ "$FALCONE_BACKUP_VERIFIED" != "true" ]]; then
    blocked deploy backup_not_verified
  else
    blocked deploy parity_not_verified
  fi
fi

cp_digest="$(json_get "$REVISION_SET" '.delivery.images.control_plane.digest')"
executor_digest="$(json_get "$REVISION_SET" '.delivery.images.control_plane_executor.digest')"
web_digest="$(json_get "$REVISION_SET" '.delivery.images.web_console.digest')"
fn_digest="$(json_get "$REVISION_SET" '.delivery.images.fn_runtime.digest')"
worker_digest="$(json_get "$REVISION_SET" '.delivery.images.workflow_worker.digest')"
mcp_digest="$(json_get "$REVISION_SET" '.delivery.images.mcp_runtime.digest')"

set_args=(
  --set-string "controlPlane.image.digest=$cp_digest"
  --set-string "controlPlaneExecutor.image.digest=$executor_digest"
  --set-string "webConsole.image.digest=$web_digest"
  --set-string "controlPlane.functionExecutor.runtimeImage.digest=$fn_digest"
  --set-string "workflowWorker.image.digest=$worker_digest"
  --set-string "mcp.runtimeImage.digest=$mcp_digest"
)
if [[ "$release_exists" == "true" ]]; then
  set_args+=(--set-string "deployment.upgrade.currentVersion=$FALCONE_CURRENT_VERSION")
  # C-25 legacy webhook signing key. Staging preserved the administrator-adopted
  # signing key across the revision-20 repair, so every staging upgrade must carry
  # create=false + adoption.mode=legacy. Otherwise the webhook-key-credential
  # pre-upgrade hook computes a canonical managed key (chart default), finds no
  # canonical Secret, cannot create on an ordinary upgrade, and fails. Mirrors
  # charts/in-falcone/migrations/revision-20-repair.sh phase-a args.
  set_args+=(
    --set "global.webhookSigningKey.create=false"
    --set-string "global.webhookSigningKey.secretName=falcone-webhook-signing-key-c25-legacy"
    --set-string "global.webhookSigningKey.secretKey=key"
    --set-string "global.webhookSigningKey.adoption.mode=legacy"
    --set-string "global.webhookSigningKey.adoption.requestId=c25-staging-adopt-20260723-01"
    --set-string "global.webhookSigningKey.rotation.action=none"
    --set-string "global.webhookSigningKey.rotation.requestId="
    --set-string "global.webhookSigningKey.rotation.sourceSecretName="
    --set-string "global.webhookSigningKey.rotation.sourceSecretKey="
    --set-string "global.webhookSigningKey.rotation.rotationId="
    --set "global.webhookSigningKey.rotation.recoveryWindowSeconds=604800"
  )
  # Preserve the immutable revision-20 Phase-A storage contract on every staging
  # upgrade. The live standalone PVCs are bound with local-path, while the live
  # SeaweedFS StatefulSet claim templates retain hcloud-volumes. Omitting these
  # values renders null/new defaults and makes Kubernetes reject the upgrade.
  # This is reconciliation only: no PVC or StatefulSet is deleted or recreated.
  set_args+=(
    --set-string "documentdb.persistence.storageClass=local-path"
    --set "documentdb.persistence.size=10Gi"
    --set-string "kafka.persistence.storageClass=local-path"
    --set "kafka.persistence.size=10Gi"
    --set-string "observability.persistence.storageClass=local-path"
    --set "observability.persistence.size=10Gi"
    --set-string "postgresql.persistence.storageClass=local-path"
    --set "postgresql.persistence.size=10Gi"
    --set-string "seaweedfs.filer.data.storageClass=hcloud-volumes"
    --set "seaweedfs.filer.data.size=10Gi"
    --set-string "seaweedfs.master.data.storageClass=hcloud-volumes"
    --set "seaweedfs.master.data.size=10Gi"
  )
  if [[ "$falcone_migration_waiver" == "true" ]]; then
    set_args+=(
      --set "global.webhookDatabase.migration.authorityReplayEnabled=false"
      --set-string "global.webhookDatabase.migration.waiverReference=$FALCONE_MIGRATION_WAIVER_ID"
    )
  else
    set_args+=(
      --set-string "global.webhookDatabase.migration.backupVerified=true"
      --set-string "global.webhookDatabase.migration.parityVerified=true"
      --set-string "global.webhookDatabase.migration.backupReference=$FALCONE_BACKUP_REFERENCE"
    )
  fi
fi

lint_args=("${set_args[@]}")
template_mode=()
if [[ "$release_exists" == "true" ]]; then
  template_mode+=(--is-upgrade)
  # helm lint has install semantics. Validate the install-compatible branch
  # here; the --is-upgrade template immediately below validates real upgrade
  # inputs (waiver or backup/parity evidence).
  lint_args+=(
    --set "global.webhookDatabase.migration.authorityReplayEnabled=true"
    --set-string "global.webhookDatabase.migration.waiverReference="
    --set "global.webhookDatabase.migration.backupVerified=false"
    --set "global.webhookDatabase.migration.parityVerified=false"
    --set-string "global.webhookDatabase.migration.backupReference="
  )
fi
helm lint --strict "$chart" "${values_args[@]}" "${lint_args[@]}"
render="$(mktemp)"
helm template "$FALCONE_HELM_RELEASE" "$chart" \
  --namespace "$FALCONE_NAMESPACE" "${template_mode[@]}" "${values_args[@]}" "${set_args[@]}" >"$render"
[[ -s "$render" ]] || blocked deploy empty_helm_render

helm upgrade --install "$FALCONE_HELM_RELEASE" "$chart" \
  --kube-context "$FALCONE_CLUSTER_CONTEXT" \
  --namespace "$FALCONE_NAMESPACE" --create-namespace \
  "${values_args[@]}" "${set_args[@]}" \
  --wait=legacy --timeout "${FALCONE_HELM_TIMEOUT:-30m}" --history-max 20

tmp="$(mktemp "${REVISION_SET}.tmp.XXXXXX")"
jq --arg chart_commit "$chart_commit" --arg deployed_at "$(date -u +%FT%TZ)" \
  '.repositories["falcone-charts"].commit=$chart_commit | .delivery.chart_commit=$chart_commit | .delivery.deployed_at=$deployed_at' \
  "$REVISION_SET" >"$tmp"
mv "$tmp" "$REVISION_SET"; chmod 600 "$REVISION_SET"

echo "FALCONE_BRANCH_DEPLOYED"
