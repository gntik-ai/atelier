#!/usr/bin/env bash
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/lib.sh
source "$SCRIPT_DIR/../common/lib.sh"
load_adapter_env falcone

output_file="${1:?Usage: backup-evidence.sh <evidence.json>}"
context="${FALCONE_CLUSTER_CONTEXT:-default}"
namespace="${FALCONE_NAMESPACE:-in-falcone-staging}"
release="${FALCONE_HELM_RELEASE:-falcone}"
source_repo="${FALCONE_SOURCE_REPO_DIR:-$HOME/projects/falcone}"
contract_file="${FALCONE_BACKUP_EVIDENCE_CONTRACT:-$source_repo/scripts/operations/staging-backup-evidence-contract.json}"
custody_dir="${FALCONE_BACKUP_CUSTODY_DIR:-$HOME/.hermes/backup-custody/falcone}"
restore_image="${FALCONE_RESTORE_POSTGRES_IMAGE:-docker.io/library/postgres:17.2-alpine@sha256:7e5df973a74872482e320dcbdeb055e178d6f42de0558b083892c50cda833c96}"

[[ "$context" == default ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=context must be default" >&2; exit 78; }
[[ "$namespace" == in-falcone-staging ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=namespace must be in-falcone-staging" >&2; exit 78; }
[[ "$release" == falcone ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=release must be falcone" >&2; exit 78; }
[[ ! -e "$output_file" ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=output_exists" >&2; exit 78; }
for tool in kubectl helm docker jq sha256sum git python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=missing_tool tool=$tool" >&2; exit 78; }
done
[[ -f "$contract_file" ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=contract_missing file=$contract_file" >&2; exit 78; }
jq -e --arg context "$context" --arg namespace "$namespace" --arg release "$release" '
  .apiVersion == "falcone.gntik.ai/v1"
  and .kind == "FalconeStagingBackupEvidenceContract"
  and .target == {context:$context,namespace:$namespace,release:$release}
  and .requiredCoverage == ["postgresql"]
  and .evidence.secretMaterialAllowed == false
  and (.evidence.maximumValidityHours | type == "number" and . > 0 and . <= 24)
' "$contract_file" >/dev/null || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=contract_invalid" >&2; exit 78; }
validity_hours="$(jq -er '.evidence.maximumValidityHours | tonumber' "$contract_file")"

current_context="$(kubectl config current-context)"
[[ "$current_context" == "$context" ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=current_context_mismatch expected=$context actual=$current_context" >&2; exit 78; }
[[ "$(kubectl --context "$context" get namespace "$namespace" -o 'jsonpath={.metadata.name}')" == "$namespace" ]] || {
  echo "BLOCKED_DELIVERY stage=backup_evidence reason=namespace_unavailable" >&2; exit 78;
}
[[ "$(kubectl --context "$context" -n "$namespace" get statefulset "$release-postgresql" -o 'jsonpath={.status.readyReplicas}/{.spec.replicas}')" == "1/1" ]] || {
  echo "BLOCKED_DELIVERY stage=backup_evidence reason=postgresql_not_single_ready_replica" >&2; exit 78;
}

helm_status="$(helm --kube-context "$context" -n "$namespace" status "$release" -o json)"
helm_revision="$(jq -er '.version | tonumber' <<<"$helm_status")"
helm_release_status="$(jq -r '.info.status' <<<"$helm_status")"
if [[ "$helm_release_status" != deployed ]]; then
  # A failed post-upgrade hook (e.g. a transient OpenBao seal during the upgrade
  # window) leaves Helm status "failed" while the database itself stays healthy
  # and unmutated. Forward recovery needs fresh revision-bound evidence against
  # that live revision before retrying the upgrade. This path is explicit opt-in
  # (FALCONE_BACKUP_FORWARD_RECOVERY=1) and still performs a real dump, isolated
  # restore and structural parity check; it never certifies a broken database.
  if [[ "${FALCONE_BACKUP_FORWARD_RECOVERY:-}" != "1" || "$helm_release_status" != failed ]]; then
    echo "BLOCKED_DELIVERY stage=backup_evidence reason=release_not_deployed status=$helm_release_status" >&2; exit 78;
  fi
fi
# Helm 4 `status -o json` no longer emits .chart/.app_version; source them from `list`.
helm_list="$(helm --kube-context "$context" -n "$namespace" list -o json)"
chart="$(jq -er --arg r "$release" '.[] | select(.name == $r) | .chart' <<<"$helm_list")"
app_version="$(jq -er --arg r "$release" '.[] | select(.name == $r) | .app_version' <<<"$helm_list")"
source_commit="$(git -C "$source_repo" rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=source_commit_invalid" >&2; exit 78; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$custody_dir" "$(dirname "$output_file")"
chmod 0700 "$custody_dir"
backup_file="$custody_dir/${release}-${namespace}-r${helm_revision}-${timestamp}.dump"
partial_file="${backup_file}.partial.$$"
restore_container="falcone-staging-restore-${timestamp,,}-$$"
cleanup() {
  docker rm --force "$restore_container" >/dev/null 2>&1 || true
  rm -f "$partial_file" "${output_file}.partial.$$"
}
trap cleanup EXIT HUP INT TERM
umask 077

kubectl --context "$context" -n "$namespace" exec "statefulset/$release-postgresql" -- sh -ec '
  set +x
  export PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD"
  exec pg_dump --format=custom --no-owner --no-acl --username=postgres --dbname="$POSTGRESQL_DATABASE"
' >"$partial_file"
[[ -s "$partial_file" ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=empty_postgresql_dump" >&2; exit 78; }
chmod 0600 "$partial_file"
backup_sha256="$(sha256sum "$partial_file" | awk '{print $1}')"
mv "$partial_file" "$backup_file"
chmod 0600 "$backup_file"

source_inventory="$(kubectl --context "$context" -n "$namespace" exec "statefulset/$release-postgresql" -- sh -ec '
  set +x
  export PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD"
  exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --username=postgres --dbname="$POSTGRESQL_DATABASE" --command="
    WITH inventory AS (
      SELECT c.oid::regclass::text AS relation,
             c.relkind::text AS kind,
              '"'"''"'"' AS owner,
             coalesce(obj_description(c.oid, '"'"'pg_class'"'"'),'"'"''"'"') AS detail
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"')
         AND c.relkind IN ('"'"'r'"'"','"'"'p'"'"','"'"'v'"'"','"'"'m'"'"','"'"'S'"'"')
      UNION ALL
      SELECT table_schema||'"'"'.'"'"'||table_name||'"'"'.'"'"'||column_name,
             ordinal_position::text,
             data_type||'"'"':'"'"'||udt_name,
             is_nullable||'"'"':'"'"'||coalesce(column_default,'"'"''"'"')
        FROM information_schema.columns
       WHERE table_schema NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"')
    )
    SELECT json_build_array(
      current_setting('"'"'server_version_num'"'"')::integer / 10000,
      md5(string_agg(concat_ws(E'"'"'\\x1f'"'"',relation,kind,owner,detail),E'"'"'\\x1e'"'"' ORDER BY relation,kind,owner,detail))
    ) FROM inventory"
')"
jq -e 'type == "array" and length == 2 and (.[0]|type=="number") and (.[1]|type=="string" and test("^[0-9a-f]{32}$"))' <<<"$source_inventory" >/dev/null || {
  echo "BLOCKED_DELIVERY stage=backup_evidence reason=source_inventory_invalid" >&2; exit 78;
}

docker run --detach --name "$restore_container" --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,size=2g --env POSTGRES_HOST_AUTH_METHOD=trust "$restore_image" >/dev/null
ready_attempts=0
until docker exec --user postgres "$restore_container" pg_isready --quiet --username postgres; do
  ready_attempts=$((ready_attempts + 1))
  [[ "$ready_attempts" -lt 60 ]] || { echo "BLOCKED_DELIVERY stage=backup_evidence reason=restore_readiness_timeout" >&2; exit 78; }
  sleep 1
done
docker cp "$backup_file" "$restore_container:/tmp/falcone-restore.dump"
docker exec "$restore_container" chmod 644 /tmp/falcone-restore.dump
docker exec --user postgres "$restore_container" createdb falcone_restore
docker exec --user postgres "$restore_container" pg_restore --exit-on-error --no-owner --no-acl --username postgres --dbname falcone_restore /tmp/falcone-restore.dump
restored_inventory="$(docker exec --user postgres "$restore_container" psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --username postgres --dbname falcone_restore --command="
  WITH inventory AS (
    SELECT c.oid::regclass::text AS relation,
           c.relkind::text AS kind,
              '' AS owner,
           coalesce(obj_description(c.oid,'pg_class'),'') AS detail
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND c.relkind IN ('r','p','v','m','S')
    UNION ALL
    SELECT table_schema||'.'||table_name||'.'||column_name,
           ordinal_position::text,
           data_type||':'||udt_name,
           is_nullable||':'||coalesce(column_default,'')
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
  )
  SELECT json_build_array(
    current_setting('server_version_num')::integer / 10000,
    md5(string_agg(concat_ws(E'\\x1f',relation,kind,owner,detail),E'\\x1e' ORDER BY relation,kind,owner,detail))
  ) FROM inventory")"
jq -e 'type == "array" and length == 2 and (.[0]|type=="number") and (.[1]|type=="string" and test("^[0-9a-f]{32}$"))' <<<"$restored_inventory" >/dev/null || {
  echo "BLOCKED_DELIVERY stage=backup_evidence reason=restored_inventory_invalid" >&2; exit 78;
}
[[ "$(jq -cS . <<<"$source_inventory")" == "$(jq -cS . <<<"$restored_inventory")" ]] || {
  echo "BLOCKED_DELIVERY stage=backup_evidence reason=postgresql_parity_mismatch" >&2; exit 78;
}
docker rm --force "$restore_container" >/dev/null

observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
valid_until="$(python3 - "$observed_at" "$validity_hours" <<'PY'
import datetime as dt,sys
v=dt.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00'))+dt.timedelta(hours=float(sys.argv[2]))
print(v.isoformat(timespec='seconds').replace('+00:00','Z'))
PY
)"
reference="falcone-staging:$context:$namespace:$release:$helm_revision:$timestamp"
tmp_evidence="${output_file}.partial.$$"
jq -n \
  --arg context "$context" --arg namespace "$namespace" --arg release "$release" \
  --argjson helmRevision "$helm_revision" --arg chart "$chart" --arg appVersion "$app_version" \
  --arg commit "$source_commit" --arg reference "$reference" --arg custodyPath "$backup_file" \
  --arg backupSha256 "$backup_sha256" --argjson sourceInventory "$source_inventory" \
  --argjson restoredInventory "$restored_inventory" --arg observedAt "$observed_at" --arg validUntil "$valid_until" '
  {
    apiVersion:"falcone.gntik.ai/v1",
    kind:"FalconeStagingBackupEvidence",
    target:{context:$context,namespace:$namespace,release:$release,helmRevision:$helmRevision,chart:$chart,appVersion:$appVersion},
    source:{repository:"gntik-ai/falcone",commit:$commit},
    coverage:{required:["postgresql"],verified:["postgresql"],unverified:[]},
    backup:{verified:true,reference:$reference,custodyPath:$custodyPath,sha256:$backupSha256,format:"postgresql-custom"},
    restore:{verified:true,isolation:{network:"none",storage:"tmpfs",sourceNamespaceMutated:false}},
    parity:{verified:true,method:"bounded-postgresql-structural-inventory-v2",sourceInventory:$sourceInventory,restoredInventory:$restoredInventory},
    observedAt:$observedAt,
    validUntil:$validUntil
  }' >"$tmp_evidence"
chmod 0600 "$tmp_evidence"
FALCONE_CLUSTER_CONTEXT="$context" FALCONE_NAMESPACE="$namespace" FALCONE_HELM_RELEASE="$release" FALCONE_BACKUP_EVIDENCE_CONTRACT="$contract_file" "$SCRIPT_DIR/validate-backup-evidence.sh" "$tmp_evidence" >/dev/null
mv "$tmp_evidence" "$output_file"
chmod 0600 "$output_file"
echo "FALCONE_STAGING_BACKUP_EVIDENCE_READY reference=$reference evidence=$output_file"
