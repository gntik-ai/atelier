#!/usr/bin/env bash
set -euo pipefail
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$PACKAGE_ROOT/hermes-workflows-suite"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
export HERMES_HOME="$HOME/.hermes"
export PATH="$T/bin:$PATH"
mkdir -p "$HERMES_HOME/project-adapters/falcone" "$T/bin" "$T/state" "$T/custody"

cat >"$T/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$KUBECTL_LOG"
case "$*" in
  "config current-context") printf '%s\n' default ;;
  "--context default get namespace in-falcone-staging -o jsonpath={.metadata.name}") printf '%s' in-falcone-staging ;;
  "--context default -n in-falcone-staging get statefulset falcone-postgresql -o jsonpath={.status.readyReplicas}/{.spec.replicas}") printf '%s' 1/1 ;;
  "--context default -n in-falcone-staging exec statefulset/falcone-postgresql -- sh -ec "*)
    case "$*" in
      *pg_dump*) printf '%s' FAKE_CUSTOM_DUMP ;;
      *psql*) printf '%s\n' '[17,42,9001]' ;;
      *) exit 99 ;;
    esac ;;
  *) printf 'unexpected kubectl invocation: %s\n' "$*" >&2; exit 98 ;;
esac
MOCK
chmod +x "$T/bin/kubectl"

cat >"$T/bin/helm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$HELM_LOG"
case "$*" in
  "--kube-context default -n in-falcone-staging status falcone -o json")
    printf '%s\n' '{"version":36,"chart":"in-falcone-0.4.19","app_version":"0.3.1","info":{"status":"deployed"}}' ;;
  *) printf 'unexpected helm invocation: %s\n' "$*" >&2; exit 98 ;;
esac
MOCK
chmod +x "$T/bin/helm"

cat >"$T/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_LOG"
case "${1:-}" in
  run) printf '%s\n' restore-container-id ;;
  exec)
    case "$*" in
      *pg_isready*) exit 0 ;;
      *psql*) printf '%s\n' '[17,42,9001]' ;;
      *) exit 0 ;;
    esac ;;
  cp|rm) exit 0 ;;
  *) printf 'unexpected docker invocation: %s\n' "$*" >&2; exit 98 ;;
esac
MOCK
chmod +x "$T/bin/docker"

cat >"$T/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$T/bin/pg_restore"

cat >"$T/bin/git" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "-C "*" rev-parse HEAD") printf '%s\n' 0123456789abcdef0123456789abcdef01234567 ;;
  *) command /usr/bin/git "$@" ;;
esac
MOCK
chmod +x "$T/bin/git"

export KUBECTL_LOG="$T/state/kubectl.log" HELM_LOG="$T/state/helm.log" DOCKER_LOG="$T/state/docker.log"
: >"$KUBECTL_LOG"; : >"$HELM_LOG"; : >"$DOCKER_LOG"
cat >"$HERMES_HOME/project-adapters/falcone/adapter.env" <<EOF
FALCONE_CLUSTER_CONTEXT=other
FALCONE_NAMESPACE=in-falcone-staging
FALCONE_HELM_RELEASE=falcone
FALCONE_SOURCE_REPO_DIR=$T/falcone
FALCONE_BACKUP_EVIDENCE_CONTRACT=$T/falcone/scripts/operations/staging-backup-evidence-contract.json
FALCONE_BACKUP_CUSTODY_DIR=$T/custody
FALCONE_RESTORE_POSTGRES_IMAGE=docker.io/library/postgres:17.2-alpine@sha256:7e5df973a74872482e320dcbdeb055e178d6f42de0558b083892c50cda833c96
EOF
mkdir -p "$T/falcone/scripts/operations"
contract_source="${FALCONE_TEST_CONTRACT_SOURCE:-$PACKAGE_ROOT/test-fixtures/falcone/staging-backup-evidence-contract.json}"
[[ -f "$contract_source" ]] || { echo "missing Falcone backup-evidence contract fixture: $contract_source" >&2; exit 1; }
cp "$contract_source" "$T/falcone/scripts/operations/"

set +e
out="$($ROOT/adapters/falcone/backup-evidence.sh "$T/evidence.json" 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$out" == *'context must be default'* ]]
[[ ! -e "$T/evidence.json" ]]

FALCONE_CLUSTER_CONTEXT=other "$ROOT/adapters/falcone/backup-evidence.sh" "$T/evidence-other.json" >/dev/null 2>&1 && exit 1 || true
[[ ! -e "$T/evidence-other.json" ]]

python3 - "$HERMES_HOME/project-adapters/falcone/adapter.env" <<'PY'
from pathlib import Path
p=Path(__import__('sys').argv[1]); s=p.read_text(); p.write_text(s.replace('FALCONE_CLUSTER_CONTEXT=other','FALCONE_CLUSTER_CONTEXT=default'))
PY

"$ROOT/adapters/falcone/backup-evidence.sh" "$T/evidence.json"
jq -e '
  .apiVersion == "falcone.gntik.ai/v1"
  and .kind == "FalconeStagingBackupEvidence"
  and .target.context == "default"
  and .target.namespace == "in-falcone-staging"
  and .target.release == "falcone"
  and .target.helmRevision == 36
  and .target.chart == "in-falcone-0.4.19"
  and .source.commit == "0123456789abcdef0123456789abcdef01234567"
  and .coverage.required == ["postgresql"]
  and .coverage.verified == ["postgresql"]
  and .coverage.unverified == []
  and .backup.verified == true
  and .restore.verified == true
  and .parity.verified == true
  and (.backup.reference | test("^falcone-staging://default/in-falcone-staging/falcone/36/"))
  and (.backup.sha256 | test("^[0-9a-f]{64}$"))
  and .parity.sourceInventory == .parity.restoredInventory
' "$T/evidence.json" >/dev/null
[[ "$(stat -c '%a' "$T/evidence.json")" == 600 ]]
backup_path="$(jq -r '.backup.custodyPath' "$T/evidence.json")"
[[ -s "$backup_path" ]]
[[ "$(stat -c '%a' "$backup_path")" == 600 ]]
! grep -q 'FAKE_CUSTOM_DUMP' "$T/evidence.json"
grep -q -- '--network none' "$DOCKER_LOG"
grep -q -- '--tmpfs /var/lib/postgresql/data:rw,nosuid,size=2g' "$DOCKER_LOG"
grep -q 'rm --force' "$DOCKER_LOG"

cp "$T/evidence.json" "$T/stale.json"
python3 - "$T/stale.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['validUntil']='2000-01-01T00:00:00Z'; json.dump(d,open(p,'w'))
PY
FALCONE_SOURCE_REPO_DIR="$T/falcone" FALCONE_BACKUP_EVIDENCE_CONTRACT="$T/falcone/scripts/operations/staging-backup-evidence-contract.json" \
  "$ROOT/adapters/falcone/validate-backup-evidence.sh" "$T/evidence.json" >/dev/null
set +e
out="$(FALCONE_SOURCE_REPO_DIR="$T/falcone" FALCONE_BACKUP_EVIDENCE_CONTRACT="$T/falcone/scripts/operations/staging-backup-evidence-contract.json" \
  "$ROOT/adapters/falcone/validate-backup-evidence.sh" "$T/stale.json" 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$out" == *'evidence_expired'* ]]

cp "$T/evidence.json" "$T/wrong-revision.json"
python3 - "$T/wrong-revision.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['target']['helmRevision']=35; json.dump(d,open(p,'w'))
PY
cat >"$T/bin/helm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$HELM_LOG"
case "$*" in
  "--kube-context default -n in-falcone-staging status falcone") exit 0 ;;
  "--kube-context default -n in-falcone-staging status falcone -o json")
    printf '%s\n' '{"version":36,"chart":"in-falcone-0.4.19","app_version":"0.3.1","info":{"status":"deployed"}}' ;;
  lint*) exit 0 ;;
  template*) printf '%s\n' 'apiVersion: v1' ;;
  upgrade*) exit 0 ;;
  *) printf 'unexpected helm invocation: %s\n' "$*" >&2; exit 98 ;;
esac
MOCK
chmod +x "$T/bin/helm"
python3 - "$HERMES_HOME/project-adapters/falcone/adapter.env" "$T/wrong-revision.json" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(); p.write_text(s + f'\nFALCONE_BACKUP_EVIDENCE_FILE={sys.argv[2]}\nFALCONE_CURRENT_VERSION=0.3.1\nFALCONE_CHART_REPO_DIR={Path(sys.argv[1]).parents[3] / "chart-repo"}\nFALCONE_CHART_RELATIVE_PATH=charts/in-falcone\nFALCONE_STAGING_VALUES_RELATIVE_PATH=charts/in-falcone/values/staging.yaml\nFALCONE_HELM_TIMEOUT=30m\n')
PY
mkdir -p "$T/home/chart-repo/.git" "$T/home/chart-repo/charts/in-falcone/values"
printf '%s\n' 'apiVersion: v2' 'name: in-falcone' 'version: 0.4.19' >"$T/home/chart-repo/charts/in-falcone/Chart.yaml"
printf '%s\n' '{}' >"$T/home/chart-repo/charts/in-falcone/values/staging.yaml"
cat >"$T/revision-set.json" <<JSON
{"repositories":{"falcone-charts":{"worktree_path":"$T/home/chart-repo","commit":"0123456789abcdef0123456789abcdef01234567"}},"delivery":{"images":{"control_plane":{"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"control_plane_executor":{"digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"web_console":{"digest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"fn_runtime":{"digest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},"workflow_worker":{"digest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},"mcp_runtime":{"digest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}}}}
JSON
set +e
out="$(FALCONE_SOURCE_REPO_DIR="$T/falcone" FALCONE_BACKUP_EVIDENCE_CONTRACT="$T/falcone/scripts/operations/staging-backup-evidence-contract.json" \
  "$ROOT/adapters/falcone/deploy-branch.sh" "$T/revision-set.json" 2>&1)"
status=$?
set -e
[[ "$status" -eq 78 ]]
[[ "$out" == *'backup_evidence_live_revision_mismatch'* ]]
! grep -q '^upgrade ' "$HELM_LOG"

echo FALCONE_BACKUP_EVIDENCE_OK
