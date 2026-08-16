#!/usr/bin/env bash
set -euo pipefail
set +x

evidence_file="${1:?Usage: validate-backup-evidence.sh <evidence.json>}"
expected_context="${FALCONE_CLUSTER_CONTEXT:-default}"
expected_namespace="${FALCONE_NAMESPACE:-in-falcone-staging}"
expected_release="${FALCONE_HELM_RELEASE:-falcone}"
source_repo="${FALCONE_SOURCE_REPO_DIR:-$HOME/projects/falcone}"
contract_file="${FALCONE_BACKUP_EVIDENCE_CONTRACT:-$D/staging-backup-evidence-contract.json}"

command -v jq >/dev/null 2>&1 || { echo "backup_evidence_invalid reason=missing_jq" >&2; exit 1; }
[[ -f "$evidence_file" ]] || { echo "backup_evidence_invalid reason=file_missing" >&2; exit 1; }
[[ -f "$contract_file" ]] || { echo "backup_evidence_invalid reason=contract_missing" >&2; exit 1; }

maximum_validity_hours="$(jq -er --arg context "$expected_context" --arg namespace "$expected_namespace" --arg release "$expected_release" '
  select(
    .apiVersion == "falcone.gntik.ai/v1"
    and .kind == "FalconeStagingBackupEvidenceContract"
    and .target == {context:$context,namespace:$namespace,release:$release}
    and .requiredCoverage == ["postgresql"]
    and .evidence.secretMaterialAllowed == false
    and (.evidence.maximumValidityHours | type == "number" and . > 0 and . <= 24)
  ) | .evidence.maximumValidityHours
' "$contract_file")" || { echo "backup_evidence_invalid reason=contract_invalid" >&2; exit 1; }

jq -e \
  --arg context "$expected_context" \
  --arg namespace "$expected_namespace" \
  --arg release "$expected_release" '
    .apiVersion == "falcone.gntik.ai/v1"
    and .kind == "FalconeStagingBackupEvidence"
    and .target.context == $context
    and .target.namespace == $namespace
    and .target.release == $release
    and (.target.helmRevision | type == "number" and . > 0)
    and (.target.chart | type == "string" and length > 0)
    and (.source.commit | test("^[0-9a-f]{40}$"))
    and .coverage.required == ["postgresql"]
    and .coverage.verified == ["postgresql"]
    and .coverage.unverified == []
    and .backup.verified == true
    and (.backup.reference | type == "string" and length > 0)
    and (.backup.sha256 | test("^[0-9a-f]{64}$"))
    and .restore.verified == true
    and .restore.isolation.network == "none"
    and .restore.isolation.storage == "tmpfs"
    and .restore.isolation.sourceNamespaceMutated == false
    and .parity.verified == true
    and .parity.method == "bounded-postgresql-structural-inventory-v2"
    and (.parity.sourceInventory | type == "array" and length == 2 and (.[0]|type=="number") and (.[1]|type=="string" and test("^[0-9a-f]{32}$")))
    and (.parity.restoredInventory | type == "array" and length == 2 and (.[0]|type=="number") and (.[1]|type=="string" and test("^[0-9a-f]{32}$")))
    and .parity.sourceInventory == .parity.restoredInventory
    and (.observedAt | type == "string" and length > 0)
    and (.validUntil | type == "string" and length > 0)
  ' "$evidence_file" >/dev/null || {
    echo "backup_evidence_invalid reason=schema_or_target_mismatch" >&2
    exit 1
  }

python3 - "$evidence_file" "$maximum_validity_hours" <<'PY'
import datetime as dt, json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data=json.load(f)
maximum=dt.timedelta(hours=float(sys.argv[2]))
def parse(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
now=dt.datetime.now(dt.timezone.utc)
try:
    observed=parse(data["observedAt"])
    valid_until=parse(data["validUntil"])
except (KeyError, TypeError, ValueError) as exc:
    print(f"backup_evidence_invalid reason=invalid_timestamp detail={type(exc).__name__}", file=sys.stderr)
    raise SystemExit(1)
if observed > now + dt.timedelta(minutes=5):
    print("backup_evidence_invalid reason=evidence_from_future", file=sys.stderr)
    raise SystemExit(1)
if valid_until <= now:
    print("backup_evidence_invalid reason=evidence_expired", file=sys.stderr)
    raise SystemExit(1)
if valid_until - observed > maximum:
    print("backup_evidence_invalid reason=evidence_window_too_long", file=sys.stderr)
    raise SystemExit(1)
PY

custody_path="$(jq -er '.backup.custodyPath' "$evidence_file")" || { echo "backup_evidence_invalid reason=custody_path_missing" >&2; exit 1; }
expected_sha="$(jq -er '.backup.sha256' "$evidence_file")"
[[ -f "$custody_path" ]] || { echo "backup_evidence_invalid reason=custody_file_missing" >&2; exit 1; }
actual_sha="$(sha256sum "$custody_path" | awk '{print $1}')"
[[ "$actual_sha" == "$expected_sha" ]] || { echo "backup_evidence_invalid reason=custody_sha256_mismatch" >&2; exit 1; }

echo "FALCONE_BACKUP_EVIDENCE_VALID"
