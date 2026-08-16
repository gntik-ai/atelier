#!/usr/bin/env bash
set -euo pipefail
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$PACKAGE_ROOT/hermes-workflows-suite"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
export HERMES_HOME="$HOME/.hermes"
export PATH="$T/bin:$PATH"
export HELM_LOG="$T/helm.log"
mkdir -p "$HOME/projects/falcone-charts/charts/in-falcone/values" "$HOME/projects/falcone-charts/charts/in-falcone/templates" "$HERMES_HOME/project-adapters/falcone" "$T/bin"
repo="$HOME/projects/falcone-charts"
git -C "$repo" init -b main >/dev/null
git -C "$repo" config user.name Test
git -C "$repo" config user.email t@example.com
printf 'apiVersion: v2\nname: in-falcone\nversion: 1.0.0\n' > "$repo/charts/in-falcone/Chart.yaml"
printf 'global: {}\n' > "$repo/charts/in-falcone/values/staging.yaml"
git -C "$repo" add .
git -C "$repo" commit -m init >/dev/null
printf '{}' > "$repo/charts/in-falcone/templates/apisix-config-file.yaml"
git -C "$repo" add charts/in-falcone/templates/apisix-config-file.yaml
git -C "$repo" commit -m "add apisix config file" >/dev/null
sha=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" remote add origin "$repo"
git -C "$repo" update-ref refs/remotes/origin/main HEAD~1
cat > "$T/bin/helm" <<'H'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$HELM_LOG"
printf '\n' >> "$HELM_LOG"
if printf '%s\n' "$@" | grep -qx status; then exit 0; fi
if [[ "${1:-}" == template ]]; then echo 'apiVersion: v1'; fi
exit 0
H
chmod +x "$T/bin/helm"
cat > "$HERMES_HOME/project-adapters/falcone/adapter.env" <<EOF2
FALCONE_CHART_REPO_DIR=$repo
FALCONE_CHART_RELATIVE_PATH=charts/in-falcone
FALCONE_STAGING_VALUES_RELATIVE_PATH=charts/in-falcone/values/staging.yaml
FALCONE_EXTRA_VALUES_FILES=
FALCONE_CLUSTER_CONTEXT=default
FALCONE_NAMESPACE=in-falcone-staging
FALCONE_HELM_RELEASE=falcone
FALCONE_HELM_TIMEOUT=30m
FALCONE_BACKUP_VERIFIED=false
FALCONE_PARITY_VERIFIED=false
FALCONE_BACKUP_REFERENCE=evidence-123
FALCONE_CURRENT_VERSION=0.3.1
FALCONE_MIGRATION_WAIVER_FILE=
EOF2
sha=$(git -C "$repo" rev-parse HEAD)
python3 - "$T/rev.json" "$repo" "$sha" <<'PY'
import json,sys
p,repo,sha=sys.argv[1:]
hexes='123456'
images={
 'control_plane':{'digest':'sha256:'+hexes[0]*64},
 'control_plane_executor':{'digest':'sha256:'+hexes[1]*64},
 'web_console':{'digest':'sha256:'+hexes[2]*64},
 'fn_runtime':{'digest':'sha256:'+hexes[3]*64},
 'workflow_worker':{'digest':'sha256:'+hexes[4]*64},
 'mcp_runtime':{'digest':'sha256:'+hexes[5]*64},
}
json.dump({'repositories':{'falcone':{'commit':'1'*40},'falcone-charts':{'worktree_path':repo,'commit':sha}},'delivery':{'images':images}},open(p,'w'))
PY
set +e
out=$("$ROOT/adapters/falcone/deploy-branch.sh" "$T/rev.json" 2>&1)
rc=$?
set -e
[[ $rc -eq 78 ]]
[[ "$out" == *backup_not_verified* ]]

# Directly flipping legacy booleans cannot authorize an upgrade.
sed -i 's/FALCONE_BACKUP_VERIFIED=false/FALCONE_BACKUP_VERIFIED=true/;s/FALCONE_PARITY_VERIFIED=false/FALCONE_PARITY_VERIFIED=true/' "$HERMES_HOME/project-adapters/falcone/adapter.env"
: > "$HELM_LOG"
set +e
out="$("$ROOT/adapters/falcone/deploy-branch.sh" "$T/rev.json" 2>&1)"
status=$?
set -e
[[ "$status" -eq 78 ]]
[[ "$out" == *backup_not_verified* ]]
! grep -q '^upgrade ' "$HELM_LOG"

# Producer-backed success is exercised by test-falcone-backup-evidence.sh.
sed -i 's/FALCONE_BACKUP_VERIFIED=true/FALCONE_BACKUP_VERIFIED=false/;s/FALCONE_PARITY_VERIFIED=true/FALCONE_PARITY_VERIFIED=false/' "$HERMES_HOME/project-adapters/falcone/adapter.env"

# The verified-evidence success path, wait strategy and immutable storage
# arguments are asserted by test-falcone-backup-evidence.sh.

# The revision-20 storage contract is upgrade-only. A fresh install must use the
# chart/profile values and must not inherit these historical reconciliation args.
python3 - "$T/bin/helm" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
s=p.read_text()
s=s.replace("if printf '%s\\n' \"$@\" | grep -qx status; then exit 0; fi", "if printf '%s\\n' \"$@\" | grep -qx status; then exit 1; fi")
p.write_text(s)
PY
: > "$HELM_LOG"
"$ROOT/adapters/falcone/deploy-branch.sh" "$T/rev.json" >/dev/null
! grep -q 'documentdb.persistence.storageClass=' "$HELM_LOG"
! grep -q 'kafka.persistence.storageClass=' "$HELM_LOG"
! grep -q 'observability.persistence.storageClass=' "$HELM_LOG"
! grep -q 'postgresql.persistence.storageClass=' "$HELM_LOG"
! grep -q 'seaweedfs.filer.data.storageClass=' "$HELM_LOG"
! grep -q 'seaweedfs.master.data.storageClass=' "$HELM_LOG"

# Continue the remaining checks through the existing-release path.
python3 - "$T/bin/helm" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
s=p.read_text().replace("if printf '%s\\n' \"$@\" | grep -qx status; then exit 1; fi", "if printf '%s\\n' \"$@\" | grep -qx status; then exit 0; fi")
p.write_text(s)
PY

# Option-B is deliberately narrow: no database authority replay, no false
# backup/parity booleans, and an exact revision-set + chart-commit binding.
sed -i 's/FALCONE_BACKUP_VERIFIED=true/FALCONE_BACKUP_VERIFIED=false/;s/FALCONE_PARITY_VERIFIED=true/FALCONE_PARITY_VERIFIED=false/' "$HERMES_HOME/project-adapters/falcone/adapter.env"
waiver="$T/waiver.json"
printf '{}\n' > "$T/snapshot-test.json"
printf '#!/usr/bin/env bash\n' > "$T/rollback-test.sh"
python3 - "$waiver" "$sha" <<'PY'
import json,sys
p,sha=sys.argv[1:]
json.dump({
  'apiVersion':'hermes.nousresearch.com/v1',
  'kind':'FalconeMigrationWaiver',
  'metadata':{
    'id':'falcone-option-b-test',
    'approvedBy':'operator-test',
    'approvedAt':'2026-08-15T00:00:00Z',
    'reason':'APISIX-only chart change; webhook database migration is out of scope',
  },
  'scope':{
    'revisionSet':p.replace('waiver.json','rev.json'),
    'chartCommit':sha,
    'allowedChangedPaths':['charts/in-falcone/templates/apisix-config-file.yaml'],
    'skipWebhookDatabaseAuthorityReplay':True,
  },
  'evidence':{
    'snapshotReference':p.replace('waiver.json','snapshot-test.json'),
    'rollbackAdapter':p.replace('waiver.json','rollback-test.sh'),
  },
},open(p,'w'))
PY
printf '\nFALCONE_MIGRATION_WAIVER_FILE=%s\n' "$waiver" >> "$HERMES_HOME/project-adapters/falcone/adapter.env"
: > "$HELM_LOG"
"$ROOT/adapters/falcone/deploy-branch.sh" "$T/rev.json" >/dev/null
grep -q 'global.webhookDatabase.migration.authorityReplayEnabled=false' "$HELM_LOG"
grep -q 'global.webhookDatabase.migration.waiverReference=falcone-option-b-test' "$HELM_LOG"
! grep -q 'global.webhookDatabase.migration.backupVerified=true' "$HELM_LOG"
! grep -q 'global.webhookDatabase.migration.parityVerified=true' "$HELM_LOG"

# Fail closed when the waiver is not bound to the exact chart commit.
python3 - "$waiver" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['scope']['chartCommit']='f'*40; json.dump(d,open(p,'w'))
PY
set +e
out=$("$ROOT/adapters/falcone/deploy-branch.sh" "$T/rev.json" 2>&1)
rc=$?
set -e
[[ $rc -eq 78 ]]
[[ "$out" == *falcone_migration_waiver_chart_commit_mismatch* ]]

echo FALCONE_UPGRADE_GATES_OK
