#!/usr/bin/env bash
# Option-B migration waiver validator for Falcone chart-only delivery.
# shellcheck shell=bash

falcone_migration_waiver_load() {
  local revision_set="$1" chart_commit="$2"
  local waiver_file="${FALCONE_MIGRATION_WAIVER_FILE:-}"
  [[ -n "$waiver_file" ]] || return 1
  waiver_file="$(expand_home "$waiver_file")"
  require_file "$waiver_file"

  jq -e '
    .apiVersion == "hermes.nousresearch.com/v1" and
    .kind == "FalconeMigrationWaiver" and
    (.metadata.id | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")) and
    (.metadata.approvedBy | type == "string" and length > 0) and
    (.metadata.approvedAt | type == "string" and fromdateiso8601 > 0) and
    (.metadata.reason | type == "string" and length >= 16) and
    (.scope.revisionSet | type == "string" and length > 0) and
    (.scope.chartCommit | type == "string" and test("^[a-f0-9]{40}$")) and
    (.scope.allowedChangedPaths | type == "array" and length > 0 and all(.[]; type == "string" and length > 0)) and
    .scope.skipWebhookDatabaseAuthorityReplay == true and
    (.evidence.snapshotReference | type == "string" and length > 0) and
    (.evidence.rollbackAdapter | type == "string" and length > 0)
  ' "$waiver_file" >/dev/null || blocked preflight falcone_migration_waiver_invalid

  local expected_revision_set expected_chart_commit waiver_id snapshot_reference rollback_adapter
  expected_revision_set="$(json_get "$waiver_file" '.scope.revisionSet')"
  expected_chart_commit="$(json_get "$waiver_file" '.scope.chartCommit')"
  waiver_id="$(json_get "$waiver_file" '.metadata.id')"
  snapshot_reference="$(json_get "$waiver_file" '.evidence.snapshotReference')"
  rollback_adapter="$(json_get "$waiver_file" '.evidence.rollbackAdapter')"

  [[ "$(readlink -f "$expected_revision_set")" == "$(readlink -f "$revision_set")" ]] \
    || blocked preflight falcone_migration_waiver_revision_set_mismatch
  [[ "$expected_chart_commit" == "$chart_commit" ]] \
    || blocked preflight falcone_migration_waiver_chart_commit_mismatch
  [[ -f "$(expand_home "$snapshot_reference")" ]] \
    || blocked preflight falcone_migration_waiver_snapshot_missing
  [[ -f "$(expand_home "$rollback_adapter")" ]] \
    || blocked preflight falcone_migration_waiver_rollback_adapter_missing

  # All changed paths are bound in the waiver and must remain outside database,
  # credential, secret, key-lifecycle, migration and generic deployment surfaces.
  local base_commit changed allowed path
  # Once an approved chart commit is merged to origin/main, merge-base resolves
  # to that commit and the branch-relative diff becomes empty. Preserve the
  # originally approved change set by comparing a main commit to its first
  # parent; for preview commits continue comparing against the base merge-base.
  base_commit="$(git -C "$chart_root" merge-base "$chart_commit" origin/main 2>/dev/null || true)"
  [[ "$base_commit" =~ ^[a-f0-9]{40}$ ]] || blocked preflight falcone_migration_waiver_base_commit_unavailable
  if [[ "$base_commit" == "$chart_commit" ]]; then
    base_commit="$(git -C "$chart_root" rev-parse "${chart_commit}^1" 2>/dev/null || true)"
    [[ "$base_commit" =~ ^[a-f0-9]{40}$ ]] || blocked preflight falcone_migration_waiver_base_parent_unavailable
  fi
  changed="$(git -C "$chart_root" diff --name-only "$base_commit" "$chart_commit")"
  [[ -n "$changed" ]] || blocked preflight falcone_migration_waiver_empty_change_set
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    allowed="$(jq -r --arg path "$path" '[.scope.allowedChangedPaths[] | select(. == $path)] | length' "$waiver_file")"
    [[ "$allowed" == "1" ]] || blocked preflight "falcone_migration_waiver_unapproved_path_$(sanitize_token "$path" 120)"
    case "$path" in
      charts/in-falcone/migrations/revision-20-repair.sh|charts/in-falcone/templates/webhook-database-authority-bootstrap.yaml|charts/in-falcone/templates/validate.yaml|charts/in-falcone/values.yaml|charts/in-falcone/values.schema.json|tests/webhook-database-principals-chart.test.mjs)
        # These exact support paths implement and verify the no-replay waiver.
        # Any other database/credential/migration surface remains forbidden.
        ;;
      *webhook*|*database*|*postgres*|*credential*|*secret*|*signing-key*|*key-lifecycle*|*migration*)
        blocked preflight "falcone_migration_waiver_forbidden_path_$(sanitize_token "$path" 120)"
        ;;
    esac
  done <<<"$changed"

  FALCONE_MIGRATION_WAIVER_ID="$waiver_id"
  FALCONE_MIGRATION_WAIVER_REFERENCE="$waiver_file"
  export FALCONE_MIGRATION_WAIVER_ID FALCONE_MIGRATION_WAIVER_REFERENCE
  return 0
}
