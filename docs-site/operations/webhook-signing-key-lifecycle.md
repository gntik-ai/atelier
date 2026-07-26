# Webhook Signing Master-Key Lifecycle Runbook

This runbook operates the platform-global master key that encrypts each persisted, tenant-scoped
webhook signing secret. It covers a fresh install, explicit adoption of pre-0.3.1 ciphertext,
canonical rotation, forward recovery, finalization, incident response, and secret-safe evidence.

> [!WARNING]
> **Release status: draft, unpublished, and partially live-verified.** On 2026-07-26 the authorized
> staging environment verified external legacy adoption plus an idempotent readiness replay with
> Falcone operational commit `35036dc72e6c8c72126b2148d60336d6aaca0248`, canonical chart commit
> `f72bdd4902a68fd293b034686b1b5269254796e5`, staging overlay commit
> `7acb07021df729e200f75afcd18c90532f545f2a`, and control-plane image
> `ghcr.io/gntik-ai/in-falcone-control-plane@sha256:27aedbfabdc8b72baae844b14dbdf72820c0f4d548a49013118d9ba7e0588d40`.
> The target was context `default`, namespace `in-falcone-staging` with UID
> `1651dd61-20e7-4734-80a1-15afb5d5fcb4`, Helm revision 16. Kubernetes `/readyz` stayed false until
> startup verification completed. No canonical rotation, recovery, or finalization was run.
> The application and chart PRs remain draft/unmerged, and the full disposable-kind and live
> OpenShift lifecycle rehearsals remain incomplete. Do not use this unpublished pair in production;
> first confirm publication and the remaining release gates in the release notes.

## Audience, outcome, and document type

**Document type:** operator runbook.

| Persona | Use this page to |
| --- | --- |
| P18 platform installer/release engineer | Install, adopt, rotate, recover, finalize, and coordinate backups and key custody. |
| P3 platform operator/SRE | Perform bounded diagnosis, verify drain/readiness, and coordinate approved forward recovery without changing the Helm release or Secret data. |
| P4 platform security/compliance auditor | Verify non-secret identity, custody mode, lifecycle state, counts, deadlines, and fail-closed posture. |
| P10 organization/workspace viewer or auditor | Consume authorized non-secret security/compliance evidence without receiving Secret-data or mutation access. |
| P17 documentation-only newcomer | Complete the supported workflow without inspecting the source tree. |

P18 is the only mutating installer/release authority in this runbook. P3 may coordinate the
maintenance window and forward-recovery decision and may perform bounded workload drain/readiness
verification under existing operational access, but must hand every Helm release or key-custody
mutation to P18. P4 and P10 consume the sanitized evidence bundle described in
[Collect audit and support evidence](#collect-audit-and-support-evidence); neither role reads
Kubernetes Secret data or receives broad pod-exec access.

**Outcome:** the control plane serves with one verified key identity, every persisted webhook secret
is tagged with that identity, a bounded recovery identity is retained when applicable, and no key
bytes enter Helm values/history, rendered YAML, command arguments, shell history, logs, Git, or
evidence.

## Prerequisites

Required knowledge:

- Kubernetes namespace and release ownership;
- PostgreSQL backup and restore operations;
- your organization's key-custody, incident, maintenance-window, and evidence-retention policies;
- the distinction between a platform master key and a tenant-facing per-subscription webhook secret.

Required tools and access:

- `helm` 3, `kubectl`, `jq`, `curl`, POSIX shell tools, and Docker or Podman;
- Docker or Podman for the local PostgreSQL 17.2 restore rehearsal, or an approved isolated
  provider restore target with equivalent cleanup guarantees;
- the exact Kubernetes context, namespace, Helm release, non-secret base values, and chart reference;
- permission to inspect and update the Helm release and its control-plane Deployment;
- permission to create or read the referenced Secret only when your custody model requires it;
- access to an approved PostgreSQL backup target and a separate Kubernetes/etcd or external-manager
  Secret backup;
- access to the compatible control-plane image in every registry used by the cluster, including a
  private or air-gapped registry;
- the historical master-key bytes in approved custody before legacy adoption. Do not recover those
  bytes by printing a pre-C-25 workload, Helm revision, or shell environment.

For OpenShift, substitute `oc` for `kubectl`. The chart renders the credential and lifecycle Jobs
under the restricted security context without a privileged SCC. At the source-verification date,
that path had render tests but not the required live OpenShift rehearsal.

## Scope, concepts, and invariants

This lifecycle is **platform-global**. It is not scoped to an organization, tenant, or workspace and
does not add a tenant role, UI, HTTP route, OpenAPI operation, SDK method, Kafka contract, or public
audit schema.

Terminology:

- **Master key:** the AES-256-GCM key that wraps persisted per-subscription webhook signing secrets.
  It is not the secret sent to a webhook consumer.
- **Key reference:** namespace, Kubernetes Secret name, and data-key name. Falcone derives the
  non-secret opaque ID `wk1:<64-lowercase-hex>` from only those three strings. The ID is not derived
  from key bytes or a key digest.
- **Canonical-v1 material:** the literal prefix `v1:` followed by exactly 43 unpadded base64url
  characters that decode to exactly 32 random bytes. Whitespace, padding, another alphabet, a
  different length, or another version fails validation.
- **Legacy material:** the exact pre-C-25 value. Its old 32-byte-or-SHA-256 normalization is permitted
  only during explicit adoption, established legacy serving, or recovery.
- **Managed custody:** `create: true`. A chart hook generates a missing canonical target inside the
  cluster, creates an immutable release-owned Secret, and retains it across upgrades and uninstall.
- **External custody:** `create: false`. An operator or external manager creates the Secret before
  Helm runs. The chart reads it only to validate it and never labels, updates, patches, or deletes it.
- **Current identity:** the only key allowed to decrypt and encrypt serving rows.
- **Recovery identity:** the preceding key retained with verification metadata until finalization.

The application applies migration `004`, resolves the required Secret-sourced key, verifies its
opaque ID, mode, encrypted sentinel, lifecycle state, and every row identity **before opening its
listener**. Missing, malformed, wrong, mixed, expired-but-unfinalized, or ambiguous state fails
closed. There is no development fallback in any environment.

The lifecycle transaction changes only each row's ciphertext, IV, and `encryption_key_id`. It
preserves the signing-secret plaintext, IDs, tenant/workspace ownership, status, grace/revocation
data, tenant authorization, quotas, per-subscription rotation behavior, and public webhook signature
format.

Ordinary webhook adapters require both a bounded runtime pool and a distinct explicit encrypted
writer pool. Construction has no writer fallback. Missing or shared pools, and either webhook pool
aliasing the global `DB_URL`/`PG*` control-plane pool at the handler seam, fail before webhook
persistence. The five-session startup verifier remains the database-level authority.

## Version compatibility

Use only a matched artifact pair:

| Artifact | Required contract |
| --- | --- |
| Umbrella chart | `in-falcone` chart `0.3.1`, `appVersion: 0.3.1`, annotation `falcone.io/webhook-key-lifecycle: v1`. |
| Control-plane image | Version `0.3.1` or a later release explicitly declared compatible with lifecycle `v1`. Chart `0.3.1` defaults to tag `0.3.1` and declares `falcone.io/min-control-plane-version: 0.3.1`. |
| Pre-C-25 deployment | Existing **Helm-managed** chart/application earlier than `0.3.1`; it must use explicit legacy adoption before canonical rotation. |

Chart metadata declares the minimum, but the template does not prove the semantic contents of a
custom image tag. Release engineering must verify that the selected image contains migration `004`,
the strict parser, startup gate, credential CLI, lifecycle CLI, and the no-fallback serving path.

The release order is mandatory:

1. publish the compatible control-plane image;
2. publish chart `0.3.1` with that image reference;
3. pin Falcone CI and deployment automation to the reviewed chart commit/release;
4. adopt each existing Helm-managed environment's legacy key in a maintenance window;
5. rotate to canonical-v1 in a later, separate maintenance operation;
6. recover if required, or finalize only after the recovery deadline and restore test.

Do not deploy the strict application image by itself through a pre-0.3.1 chart, and do not deploy the
new chart with an older image.

> [!IMPORTANT]
> The legacy adoption procedure migrates webhook ciphertext inside an existing Helm-managed release;
> it does not import plain-manifest Kubernetes/OpenShift resources into Helm. No supported or safely
> rehearsed manual-to-Helm resource-import path exists. A manual OpenShift installation on legacy `0.3.0`
> is not a supported C-25/chart `0.3.1` install or upgrade path; it must remain pinned to `0.3.0`
> and continue its existing manual process until a separate manual-to-Helm migration is approved and rehearsed.
> Copying only a newer image into those manual manifests is unsafe and unsupported.
> Do not use this runbook to add Helm ownership metadata, take ownership,
> delete/recreate resources, or improvise rollback for that population.

Upgrade compatibility is also fail-closed:

> [!CAUTION]
> Chart `0.3.1` accepts `deployment.upgrade.currentVersion` values `0.2.0`, `0.3.0`, and `0.3.1`.
> Keep the truthful installed-source version in the upgrade values and run the chart's validation
> before any lifecycle action. This permits later lifecycle maintenance upgrades after `0.3.1` is
> installed; unsupported source versions and downgrades remain rejected. Do not falsify this field
> or use `deployment.upgrade.allowInPlace=false` merely to bypass compatibility validation.

## Complete `global.webhookSigningKey` values contract

There is deliberately no value/inline field.

| Field | Type and accepted values | Default | Meaning |
| --- | --- | --- | --- |
| `create` | Boolean | `true` | `true` selects chart-managed custody; `false` selects a pre-existing external Secret. |
| `secretName` | 1–253 characters; lowercase DNS-style pattern `^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$` | `in-falcone-webhook-signing-key` | Current or target Secret name in the release namespace. |
| `secretKey` | 1–253 characters; `^[A-Za-z0-9._-]+$` | `key` | Data-key name inside the current or target Secret. |
| `adoption.mode` | `none` or `legacy` | `none` | Selects normal canonical operation or explicit pre-C-25 legacy adoption/serving. |
| `adoption.requestId` | Empty, or 1–128 characters matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` | Empty | Idempotency ID required for `legacy`; empty for `none`. |
| `rotation.action` | `none`, `rotate`, `recover`, or `finalize` | `none` | Upgrade-only lifecycle action. Legacy adoption is represented by `adoption.mode: legacy` with action `none`. |
| `rotation.requestId` | Empty, or the same ID pattern as adoption | Empty | Required and unique for every non-`none` action. |
| `rotation.sourceSecretName` | Empty, or the same name pattern as `secretName` | Empty | Source/current Secret for rotate/recover; recovery Secret for finalize. |
| `rotation.sourceSecretKey` | Empty, or the same key pattern as `secretKey` | Empty | Data-key name in the source/recovery Secret. |
| `rotation.rotationId` | Empty, or the same ID pattern as adoption | Empty | Required and unique for rotate/recover. The current schema accepts it for finalize, but finalize does not use it; leave it empty. It must be empty for none. |
| `rotation.recoveryWindowSeconds` | Integer 300–2,592,000 | `604800` | Recovery retention from 5 minutes through 30 days; the default is 7 days. |

Cross-field validation rejects the release before hooks or workloads render when:

- adoption, rotation, recovery, or finalization is requested during `helm install` rather than
  `helm upgrade`;
- `controlPlane.env` contains any entry named `WEBHOOK_SIGNING_KEY`, whether it uses `value` or
  `valueFrom`;
- `global.transportSecurity.env` contains an entry named `WEBHOOK_SIGNING_KEY`, even when transport
  security is disabled or the control plane has not opted in;
- `controlPlane.config.inline` contains a `WEBHOOK_SIGNING_KEY` map key that would render into the
  generated env ConfigMap;
- an unknown/inline field is present;
- legacy adoption lacks `adoption.requestId`, or uses `create: true` outside canonical rotation;
- `adoption.mode: none` has a non-empty adoption request ID;
- action `none` has a request, source, or rotation ID;
- a lifecycle action lacks its request ID;
- rotate/recover lacks a source name, source key, or rotation ID;
- finalize lacks a recovery source name or key;
- source and target resolve to the same Secret name and data-key name;
- the recovery window, name, key, or ID fails its schema.

The chart injects exactly one required control-plane environment entry:

```yaml
- name: WEBHOOK_SIGNING_KEY
  valueFrom:
    secretKeyRef:
      name: <current-secret-name>
      key: <current-data-key-name>
      optional: false
```

Only non-secret mode, opaque ID, action, request ID, and rotation ID appear in workload environment
or rollout annotations. The control-plane pod template also carries
`in-falcone.io/release-revision`, derived only from the Helm release revision. Every upgrade therefore
creates a new ReplicaSet and reruns the startup sentinel/state check even when the Secret name and
data-key name are unchanged. The annotation is never derived from Secret bytes.

## Secret-handling rules

Follow these rules in every procedure:

- Start the shell with `set +x`. Do not enable shell tracing around secret or backup operations.
- Never put key material in `--set`, `--set-string`, a values file, environment assignment, command
  argument, ConfigMap, rendered manifest, Git, ticket, chat, terminal transcript, screenshot, log,
  metric, Event, or evidence artifact.
- Never use `kubectl get secret ... -o yaml|json`, `kubectl describe secret`, `helm get values --all`,
  `helm get manifest`, `env`, `printenv`, `/proc/<pid>/environ`, or a broad support bundle as evidence.
- Literal key bytes enter Falcone only through the data key of the referenced Kubernetes Secret. For
  external custody, use your approved manager/controller, or a direct Kubernetes Secret create from
  a protected file descriptor/path. Do not render a Secret manifest.
- Keep old and current key custody until the database backup/restore pairing has been tested and the
  recovery identity has been finalized.
- Treat database backups, Kubernetes/etcd backups, and external-manager versions as restricted
  secret-bearing recovery assets even when the operator evidence contains only their IDs.
- Do not mutate an externally managed current Secret in place. A new key always receives a new
  Secret name or data-key name, which creates a new opaque identity.

Kubernetes Secret base64 encoding is not encryption. Cluster operators remain responsible for:

- least-privilege Secret RBAC and separation between P18 mutation and P4/P10 evidence review;
- Kubernetes API and etcd encryption at rest, key rotation, and encrypted etcd/cluster backups;
- kubelet/node/root/container-runtime access that can expose mounted or environment-delivered data;
- limiting and auditing pod `exec`, ephemeral containers, debug containers, process inspection, and
  crash dumps;
- backup encryption, retention, restore authorization, and matching-key inventory;
- external-manager availability, access policy, immutable/versioned retention, and prevention of
  same-name reconciliation;
- log, metric, Event, support-bundle, CI, and evidence redaction.

## Establish the target context

Use explicit placeholders and keep them non-secret:

```bash
set -eu
set +x

export FALCONE_CONTEXT='<exact-kube-context>'
export FALCONE_NAMESPACE='<release-namespace>'
export FALCONE_RELEASE='<helm-release>'
export FALCONE_CHART_SOURCE='<matching-reviewed-falcone-charts-source-checkout>'
export FALCONE_CHART="${FALCONE_CHART_SOURCE}/charts/in-falcone"
export FALCONE_EXPECTED_CHART_SHA='<approved-chart-source-commit>'
export FALCONE_EXPECTED_CONTROL_PLANE_IMAGE='<approved-image-reference-with-sha256-digest>'
export FALCONE_BASE_VALUES='<reviewed-non-secret-base-values-file>'
export FALCONE_KEY_VALUES='<reviewed-non-secret-install-or-action-none-key-values-file>'
export FALCONE_ACTION_KEY_VALUES='<reviewed-non-secret-lifecycle-action-values-file>'
export FALCONE_BACKUP_REFERENCE='<non-secret-backup-evidence-id>'
export FALCONE_CONTROL_PLANE="${FALCONE_RELEASE}-control-plane"
export FALCONE_POSTGRES="${FALCONE_RELEASE}-postgresql"

test "$(kubectl config current-context)" = "$FALCONE_CONTEXT"
kubectl get namespace "$FALCONE_NAMESPACE" >/dev/null
test "$(git -C "$FALCONE_CHART_SOURCE" rev-parse HEAD)" = "$FALCONE_EXPECTED_CHART_SHA"
test -z "$(git -C "$FALCONE_CHART_SOURCE" status --short)"
test "$(realpath -- "$FALCONE_CHART")" = \
  "$(realpath -- "$FALCONE_CHART_SOURCE/charts/in-falcone")"
test -n "$FALCONE_BACKUP_REFERENCE"
helm version --short
kubectl version --client
```

For a fresh install, create the namespace first or use your standard `--create-namespace` flow; then
repeat the exact-context check. Stop if the context, namespace, release, or image registry could be a
production target outside the approved maintenance request.

Inspect only non-secret chart metadata:

```bash
helm show chart "$FALCONE_CHART" |
  awk '/^(name|version|appVersion):|^  falcone.io\/(min-control-plane-version|webhook-key-lifecycle):/'
```

Expected fields are chart/app version `0.3.1`, minimum control-plane `0.3.1`, and lifecycle `v1`.
Verify that the selected base/key values still render the approved digest-pinned control-plane
image; this command renders only the control-plane workload and prints no Secret object:

```bash
FALCONE_SELECTED_CONTROL_PLANE_IMAGE="$(
  helm template "$FALCONE_RELEASE" "$FALCONE_CHART" \
    --namespace "$FALCONE_NAMESPACE" \
    --show-only charts/controlPlane/templates/workload.yaml \
    --values "$FALCONE_BASE_VALUES" \
    --values "$FALCONE_KEY_VALUES" |
    awk '
      $0 ~ /^[[:space:]]*- name: control-plane$/ { control_plane = 1; next }
      control_plane && $1 == "image:" {
        gsub(/^"|"$/, "", $2)
        print $2
        exit
      }
    '
)"
test "$FALCONE_SELECTED_CONTROL_PLANE_IMAGE" = \
  "$FALCONE_EXPECTED_CONTROL_PLANE_IMAGE"
unset FALCONE_SELECTED_CONTROL_PLANE_IMAGE
```

For an existing release, record non-secret identity and replica posture:

```bash
helm list --namespace "$FALCONE_NAMESPACE" --filter "^${FALCONE_RELEASE}$" --output json |
  jq 'map({name,namespace,revision,status,chart,app_version,updated})'

kubectl --namespace "$FALCONE_NAMESPACE" get deployment "$FALCONE_CONTROL_PLANE" \
  -o jsonpath='{.metadata.name}{" desired="}{.spec.replicas}{" available="}{.status.availableReplicas}{"\n"}'
```

Confirm the operator can perform the exact operation. These commands return only `yes` or `no`:

```bash
kubectl auth can-i get deployments.apps --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i patch deployments.apps --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i get secrets --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i create secrets --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i create serviceaccounts --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i create roles.rbac.authorization.k8s.io --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i create rolebindings.rbac.authorization.k8s.io --namespace "$FALCONE_NAMESPACE"
kubectl auth can-i create jobs.batch --namespace "$FALCONE_NAMESPACE"
```

External custody gives the chart credential hook `get` only for the exact configured Secret name.
Managed fresh/target creation uses that same exact-name `get` rule plus a separate namespace-scoped
`create` rule (Kubernetes cannot constrain a create authorization check with `resourceNames`).
Explicit finalization gives the lifecycle hook ServiceAccount `get`/`delete` only for the named
recovery Secret; the human operator does not need direct Secret-delete permission. Neither hook can
list, watch, update, or patch Secrets. The Helm actor must be able to create the dedicated hook
ServiceAccounts, Roles, RoleBindings, and Jobs.

## Back up and bind backup custody to key custody

Adoption, rotation, and recovery require a declared maintenance window, a tested PostgreSQL backup,
and custody of every current/recovery Secret. A database backup without the matching key identity is
not recoverable by Falcone.

### Back up the bundled PostgreSQL database

For the chart-bundled PostgreSQL only, create a custom-format logical backup without exposing its
password. The password and user already enter the database pod from its Kubernetes Secret.

```bash
export FALCONE_DB_BACKUP='<restricted-backup-path>/in-falcone-pre-webhook-key.dump'
export FALCONE_RESTORE_POSTGRES_IMAGE='docker.io/library/postgres:17.2-alpine@sha256:7e5df973a74872482e320dcbdeb055e178d6f42de0558b083892c50cda833c96'
test ! -e "$FALCONE_DB_BACKUP"
test "${FALCONE_DB_BACKUP#/}" != "$FALCONE_DB_BACKUP"
umask 077

kubectl --namespace "$FALCONE_NAMESPACE" exec "statefulset/${FALCONE_POSTGRES}" -- \
  sh -ec '
    set +x
    export PGPASSWORD="$POSTGRESQL_PASSWORD"
    exec pg_dump --format=custom --no-owner --no-acl \
      --username="$POSTGRESQL_USERNAME" \
      --dbname="$POSTGRESQL_DATABASE"
  ' > "$FALCONE_DB_BACKUP"

test -s "$FALCONE_DB_BACKUP"
chmod 0600 "$FALCONE_DB_BACKUP"
docker run --rm --network none \
  --mount \
    "type=bind,source=${FALCONE_DB_BACKUP},target=/tmp/falcone-backup.dump,readonly" \
  "$FALCONE_RESTORE_POSTGRES_IMAGE" \
  pg_restore --list /tmp/falcone-backup.dump >/dev/null
sha256sum "$FALCONE_DB_BACKUP" > "${FALCONE_DB_BACKUP}.sha256"
```

Expected state: the dump and checksum exist under restricted backup custody; no database password or
master-key byte was printed. The archive-list check uses the same digest-pinned PostgreSQL 17.2
tooling as the restore rehearsal, not an unversioned host client. `pg_restore --list` checks archive
readability, not restoration.

### Size the maintenance transaction

Before adoption, rotation, or recovery, collect bounded decision inputs for row count, encrypted-row
footprint, relation size, current WAL footprint, filesystem free space, and a read-only count-scan
duration. This does not predict an exact transaction duration or WAL volume; Falcone has no portable
threshold because storage, PostgreSQL configuration, row size, and I/O throughput differ by
installation.

For the bundled PostgreSQL, this command prints counts, byte totals, query timing, and filesystem
capacity only. It does not select ciphertext, IVs, key material, tenant data, or Secret objects:

```bash
kubectl --namespace "$FALCONE_NAMESPACE" exec "statefulset/${FALCONE_POSTGRES}" -- \
  sh -ec '
    set +x
    export PGPASSWORD="$POSTGRESQL_PASSWORD"
    psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --username="$POSTGRESQL_USERNAME" \
      --dbname="$POSTGRESQL_DATABASE" <<'"'"'SQL'"'"'
SET statement_timeout = '"'"'120s'"'"';
SET lock_timeout = '"'"'5s'"'"';
SET transaction_read_only = on;
SELECT json_build_object(
  '"'"'rowCount'"'"', count(*),
  '"'"'encryptedFieldBytes'"'"',
    coalesce(sum(octet_length(secret_cipher) + octet_length(secret_iv)), 0),
  '"'"'relationBytes'"'"', pg_total_relation_size('"'"'webhook_signing_secrets'"'"'::regclass),
  '"'"'databaseBytes'"'"', pg_database_size(current_database())
) FROM webhook_signing_secrets;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM webhook_signing_secrets;
SQL
    printf "walKiB="
    du -sk "$PGDATA/pg_wal" | awk '"'"'{print $1}'"'"'
    df -Pk "$PGDATA" | awk '"'"'NR == 2 {
      printf "filesystemKiB=%s usedKiB=%s availableKiB=%s usePercent=%s\n",
        $2, $3, $4, $5
    }'"'"'
  '
```

Use the result with the observed backup/restore duration, the 30-minute lifecycle statement timeout,
the Helm timeout, database/WAL retention settings, storage alert headroom, replica drain time, and
your approved maintenance window. Stop and resize the window/storage or rehearse against a restored
copy when the inputs do not leave approved headroom. Do not invent a universal ratio or claim that
the read-only scan measures AES transform or commit/WAL latency. Managed/external PostgreSQL users
should run the equivalent provider-approved read-only sizing queries and capacity checks.

### Rehearse the bundled backup on matching PostgreSQL 17.2

Archive listing is not a restore rehearsal. The following local procedure restores the bundled
PostgreSQL 17.2 backup into an isolated PostgreSQL 17.2 container with no published network port,
compares bounded schema/row inventory with the source, and always removes the container. It never selects a
signing-secret row, ciphertext, IV, tenant field, credential, or key material:

```bash
export FALCONE_RESTORE_CONTAINER="falcone-webhook-restore-$(date -u +%Y%m%d%H%M%S)"
test -s "$FALCONE_DB_BACKUP"

cleanup_webhook_restore() {
  docker rm --force "$FALCONE_RESTORE_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup_webhook_restore EXIT HUP INT TERM

docker run --detach \
  --name "$FALCONE_RESTORE_CONTAINER" \
  --network none \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=2g \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  "$FALCONE_RESTORE_POSTGRES_IMAGE" >/dev/null

until docker exec --user postgres "$FALCONE_RESTORE_CONTAINER" \
  pg_isready --quiet --username postgres; do
  sleep 1
done

docker cp "$FALCONE_DB_BACKUP" \
  "${FALCONE_RESTORE_CONTAINER}:/tmp/falcone-restore.dump"
docker exec --user postgres "$FALCONE_RESTORE_CONTAINER" \
  createdb falcone_restore
docker exec --user postgres "$FALCONE_RESTORE_CONTAINER" \
  pg_restore --exit-on-error --no-owner --no-acl \
    --username postgres --dbname falcone_restore \
    /tmp/falcone-restore.dump

FALCONE_SOURCE_INVENTORY="$(
  kubectl --namespace "$FALCONE_NAMESPACE" exec \
    "statefulset/${FALCONE_POSTGRES}" -- sh -ec '
      set +x
      export PGPASSWORD="$POSTGRESQL_PASSWORD"
      exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
        --username="$POSTGRESQL_USERNAME" \
        --dbname="$POSTGRESQL_DATABASE" \
        --command="
          SELECT json_build_array(
            current_setting('"'"'server_version_num'"'"')::integer / 10000,
            (SELECT count(*) FROM pg_class
              WHERE relnamespace = '"'"'public'"'"'::regnamespace
                AND relkind = '"'"'r'"'"'
                AND relname IN (
                  '"'"'webhook_subscriptions'"'"',
                  '"'"'webhook_signing_secrets'"'"',
                  '"'"'webhook_deliveries'"'"',
                  '"'"'webhook_delivery_attempts'"'"',
                  '"'"'webhook_master_key_state'"'"',
                  '"'"'webhook_master_key_rotations'"'"')),
            (SELECT count(*) FROM pg_proc
              WHERE pronamespace = '"'"'public'"'"'::regnamespace
                AND proname IN (
                  '"'"'falcone_webhook_key_write_current_id'"'"',
                  '"'"'falcone_webhook_signing_secret_write_statement_fence'"'"',
                  '"'"'falcone_webhook_signing_secret_write_fence'"'"')),
            (SELECT count(*) FROM webhook_signing_secrets)
          )"
    '
)"

FALCONE_RESTORE_INVENTORY="$(
  docker exec --user postgres "$FALCONE_RESTORE_CONTAINER" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
      --username postgres --dbname falcone_restore \
      --command="
        SELECT json_build_array(
          current_setting('server_version_num')::integer / 10000,
          (SELECT count(*) FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relkind = 'r'
              AND relname IN (
                'webhook_subscriptions',
                'webhook_signing_secrets',
                'webhook_deliveries',
                'webhook_delivery_attempts',
                'webhook_master_key_state',
                'webhook_master_key_rotations')),
          (SELECT count(*) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace
              AND proname IN (
                'falcone_webhook_key_write_current_id',
                'falcone_webhook_signing_secret_write_statement_fence',
                'falcone_webhook_signing_secret_write_fence')),
          (SELECT count(*) FROM webhook_signing_secrets)
        )"
)"

test "$FALCONE_SOURCE_INVENTORY" = "$FALCONE_RESTORE_INVENTORY"
printf 'restore inventory verified: %s\n' "$FALCONE_RESTORE_INVENTORY"
unset FALCONE_RESTORE_INVENTORY
cleanup_webhook_restore
trap - EXIT HUP INT TERM
```

An initial pre-0.3.1 backup normally reports four webhook tables and zero lifecycle functions; a
post-handoff backup reports six tables and three functions. The signing-secret count must match in
both cases. Do not hard-code either inventory: exact source/restore equality is the acceptance gate.
`pg_dump` archives are not guaranteed to be readable by an older major-version client or server.
The bundled chart currently runs PostgreSQL `17.2.0`, so this literal procedure deliberately uses
the matching `17.2` image. For another supported source, select an approved image at the source
server's major version or newer and prove compatibility before treating the restore gate as passed;
never rehearse a PostgreSQL 17 archive with PostgreSQL 16 tooling.

### Rehearse matching-key startup and readiness on the restored copy

Database parity alone does not prove key custody. Use an approved disposable Kubernetes context and
namespace, never the audited/production namespace. The literal bundled-database procedure below
installs the truthful pre-C-25 source chart, restores the backup into a new database owned by the
legacy application role in that release's PostgreSQL 17.2 instance, and then upgrades the same
release with the reviewed C-25 chart. The ordinary source database remains separate; only the
candidate's bounded webhook database connections select the restored database.

Prepare:

- `FALCONE_RESTORE_CONTEXT`, which must be an approved disposable context, and a unique
  `FALCONE_RESTORE_NAMESPACE`;
- `FALCONE_RESTORE_RELEASE`, a unique release name;
- `FALCONE_RESTORE_SOURCE_CHART_SOURCE`, a clean reviewed pre-C-25 chart checkout at
  `FALCONE_RESTORE_EXPECTED_SOURCE_CHART_SHA`; the audited canonical 0.3.0 source is
  `9aab27e7695e20156b7a4f61b5f2f789f59ee59a`;
- `FALCONE_RESTORE_SOURCE_CHART`, derived only as
  `${FALCONE_RESTORE_SOURCE_CHART_SOURCE}/charts/in-falcone`;
- `FALCONE_RESTORE_SOURCE_VALUES`, the isolated non-production values for that source release;
- `FALCONE_RESTORE_BASE_VALUES`, the reviewed C-25 non-secret base values;
- `FALCONE_RESTORE_ACTION_KEY_VALUES`, referencing the matching retained key through a newly
  provisioned Secret in the disposable namespace;
- a truthful restored source version and the same non-secret backup evidence ID. Provision the
  matching Secret through the approved external-manager or P18 custody workflow; never put its
  value in a Helm value, command argument, terminal output, or evidence file.

The following commands create the namespace and source release, stream the restricted backup into
that release without printing it, restore it under the legacy application owner, compare the same
bounded inventory used above, and leave a cleanup trap active for every failure path:

```bash
export FALCONE_RESTORE_DATABASE='falcone_restore'
export FALCONE_RESTORE_SOURCE_CHART_SOURCE='<reviewed-pre-C-25-falcone-charts-checkout>'
export FALCONE_RESTORE_EXPECTED_SOURCE_CHART_SHA='<approved-pre-C-25-chart-source-commit>'
export FALCONE_RESTORE_SOURCE_CHART="${FALCONE_RESTORE_SOURCE_CHART_SOURCE}/charts/in-falcone"
test -n "$FALCONE_SOURCE_INVENTORY"
test "$(kubectl config current-context)" = "$FALCONE_RESTORE_CONTEXT"
test "$FALCONE_RESTORE_NAMESPACE" != "$FALCONE_NAMESPACE"
test "$FALCONE_RESTORE_RELEASE" != "$FALCONE_RELEASE"
test "$FALCONE_RESTORE_INSTALLED_VERSION" = '0.3.0'
test "$(
  git -C "$FALCONE_RESTORE_SOURCE_CHART_SOURCE" rev-parse HEAD
)" = "$FALCONE_RESTORE_EXPECTED_SOURCE_CHART_SHA"
test -z "$(git -C "$FALCONE_RESTORE_SOURCE_CHART_SOURCE" status --short)"
test "$(realpath -- "$FALCONE_RESTORE_SOURCE_CHART")" = "$(
  realpath -- "$FALCONE_RESTORE_SOURCE_CHART_SOURCE/charts/in-falcone"
)"
test "$(
  helm show chart "$FALCONE_RESTORE_SOURCE_CHART" |
    awk '$1 == "appVersion:" { gsub(/"/, "", $2); print $2; exit }'
)" = "$FALCONE_RESTORE_INSTALLED_VERSION"
test -s "$FALCONE_DB_BACKUP"

cleanup_webhook_kube_restore() {
  if helm --kube-context "$FALCONE_RESTORE_CONTEXT" \
    --namespace "$FALCONE_RESTORE_NAMESPACE" \
    status "$FALCONE_RESTORE_RELEASE" >/dev/null 2>&1; then
    helm --kube-context "$FALCONE_RESTORE_CONTEXT" \
      --namespace "$FALCONE_RESTORE_NAMESPACE" \
      uninstall "$FALCONE_RESTORE_RELEASE" --wait
  fi
  if kubectl --context "$FALCONE_RESTORE_CONTEXT" \
    get namespace "$FALCONE_RESTORE_NAMESPACE" >/dev/null 2>&1; then
    kubectl --context "$FALCONE_RESTORE_CONTEXT" \
      delete namespace "$FALCONE_RESTORE_NAMESPACE" --wait
  fi
}
trap cleanup_webhook_kube_restore EXIT HUP INT TERM

if kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  get namespace "$FALCONE_RESTORE_NAMESPACE" >/dev/null 2>&1; then
  printf '%s\n' 'refusing restore rehearsal: namespace already exists' >&2
  exit 1
fi
kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  create namespace "$FALCONE_RESTORE_NAMESPACE"

helm --kube-context "$FALCONE_RESTORE_CONTEXT" \
  install "$FALCONE_RESTORE_RELEASE" "$FALCONE_RESTORE_SOURCE_CHART" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" \
  --values "$FALCONE_RESTORE_SOURCE_VALUES" \
  --wait --timeout 40m

kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" rollout status \
  "statefulset/${FALCONE_RESTORE_RELEASE}-postgresql" --timeout 10m

kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" exec -i \
  "statefulset/${FALCONE_RESTORE_RELEASE}-postgresql" -- \
  sh -ec 'umask 077; cat > /tmp/falcone-restore.dump' \
  < "$FALCONE_DB_BACKUP"

kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" exec \
  "statefulset/${FALCONE_RESTORE_RELEASE}-postgresql" -- \
  sh -ec '
    set +x
    export PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD"
    test "$(
      psql --no-psqlrc --tuples-only --no-align \
        --host=127.0.0.1 --username=postgres --dbname=postgres \
        --command="SELECT count(*) FROM pg_database WHERE datname='"'"'falcone_restore'"'"'"
    )" = "0"
    createdb --host=127.0.0.1 --username=postgres \
      --owner="$POSTGRESQL_USERNAME" falcone_restore
    export PGPASSWORD="$POSTGRESQL_PASSWORD"
    pg_restore --exit-on-error --no-owner --no-acl \
      --host=127.0.0.1 \
      --username="$POSTGRESQL_USERNAME" \
      --dbname=falcone_restore \
      /tmp/falcone-restore.dump
    rm -f /tmp/falcone-restore.dump
  '

FALCONE_RESTORED_CLUSTER_INVENTORY="$(
  kubectl --context "$FALCONE_RESTORE_CONTEXT" \
    --namespace "$FALCONE_RESTORE_NAMESPACE" exec \
    "statefulset/${FALCONE_RESTORE_RELEASE}-postgresql" -- sh -ec '
      set +x
      export PGPASSWORD="$POSTGRESQL_PASSWORD"
      exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
        --host=127.0.0.1 \
        --username="$POSTGRESQL_USERNAME" \
        --dbname=falcone_restore \
        --command="
          SELECT json_build_array(
            current_setting('"'"'server_version_num'"'"')::integer / 10000,
            (SELECT count(*) FROM pg_class
              WHERE relnamespace = '"'"'public'"'"'::regnamespace
                AND relkind = '"'"'r'"'"'
                AND relname IN (
                  '"'"'webhook_subscriptions'"'"',
                  '"'"'webhook_signing_secrets'"'"',
                  '"'"'webhook_deliveries'"'"',
                  '"'"'webhook_delivery_attempts'"'"',
                  '"'"'webhook_master_key_state'"'"',
                  '"'"'webhook_master_key_rotations'"'"')),
            (SELECT count(*) FROM pg_proc
              WHERE pronamespace = '"'"'public'"'"'::regnamespace
                AND proname IN (
                  '"'"'falcone_webhook_key_write_current_id'"'"',
                  '"'"'falcone_webhook_signing_secret_write_statement_fence'"'"',
                  '"'"'falcone_webhook_signing_secret_write_fence'"'"')),
            (SELECT count(*) FROM webhook_signing_secrets)
          )"
    '
)"
test "$FALCONE_SOURCE_INVENTORY" = "$FALCONE_RESTORED_CLUSTER_INVENTORY"
printf 'cluster restore inventory verified: %s\n' \
  "$FALCONE_RESTORED_CLUSTER_INVENTORY"
unset FALCONE_RESTORED_CLUSTER_INVENTORY
```

Run the same server-side dry-run used by the real handoff, explicitly point the candidate's webhook
connections at the restored database, apply only after validation passes, and verify that Kubernetes
readiness is driven by `/readyz`:

```bash

if kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" get configmap \
  in-falcone-webhook-database-credentials-initialized >/dev/null 2>&1; then
  FALCONE_RESTORE_FIRST_HANDOFF=false
else
  FALCONE_RESTORE_FIRST_HANDOFF=true
fi
export FALCONE_RESTORE_FIRST_HANDOFF

helm --kube-context "$FALCONE_RESTORE_CONTEXT" \
  upgrade "$FALCONE_RESTORE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" \
  --values "$FALCONE_RESTORE_BASE_VALUES" \
  --values "$FALCONE_RESTORE_ACTION_KEY_VALUES" \
  --set-string \
    "deployment.upgrade.currentVersion=${FALCONE_RESTORE_INSTALLED_VERSION}" \
  --set-string \
    "global.webhookDatabase.connection.host=${FALCONE_RESTORE_RELEASE}-postgresql" \
  --set-string \
    "global.webhookDatabase.connection.database=${FALCONE_RESTORE_DATABASE}" \
  --set \
    "global.webhookDatabase.migration.firstHandoff=${FALCONE_RESTORE_FIRST_HANDOFF}" \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --dry-run=server --hide-secret >/dev/null

helm --kube-context "$FALCONE_RESTORE_CONTEXT" \
  upgrade "$FALCONE_RESTORE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" \
  --values "$FALCONE_RESTORE_BASE_VALUES" \
  --values "$FALCONE_RESTORE_ACTION_KEY_VALUES" \
  --set-string \
    "deployment.upgrade.currentVersion=${FALCONE_RESTORE_INSTALLED_VERSION}" \
  --set-string \
    "global.webhookDatabase.connection.host=${FALCONE_RESTORE_RELEASE}-postgresql" \
  --set-string \
    "global.webhookDatabase.connection.database=${FALCONE_RESTORE_DATABASE}" \
  --set \
    "global.webhookDatabase.migration.firstHandoff=${FALCONE_RESTORE_FIRST_HANDOFF}" \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m

kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" rollout status \
  "deployment/${FALCONE_RESTORE_RELEASE}-control-plane" --timeout 10m
test "$(
  kubectl --context "$FALCONE_RESTORE_CONTEXT" \
    --namespace "$FALCONE_RESTORE_NAMESPACE" get deployment \
    "${FALCONE_RESTORE_RELEASE}-control-plane" \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="control-plane")].readinessProbe.httpGet.path}'
)" = '/readyz'

test "$(
  kubectl --context "$FALCONE_RESTORE_CONTEXT" \
    --namespace "$FALCONE_RESTORE_NAMESPACE" get --raw \
    "/api/v1/namespaces/${FALCONE_RESTORE_NAMESPACE}/services/http:${FALCONE_RESTORE_RELEASE}-control-plane:http/proxy/readyz" |
    jq -r .status
)" = 'ok'

FALCONE_RESTORE_STATUS="$(
  kubectl --context "$FALCONE_RESTORE_CONTEXT" \
    --namespace "$FALCONE_RESTORE_NAMESPACE" exec \
    "deployment/${FALCONE_RESTORE_RELEASE}-control-plane" -- \
    env WEBHOOK_KEY_LIFECYCLE_ACTION=status \
    node /app/webhook-key-lifecycle-cli.mjs |
    jq -c .
)"
test "$(printf '%s\n' "$FALCONE_RESTORE_STATUS" | jq -r .state.lifecycleState)" = 'serving'
test "$(printf '%s\n' "$FALCONE_RESTORE_STATUS" | jq -r .state.currentMode)" = 'legacy'
test "$(printf '%s\n' "$FALCONE_RESTORE_STATUS" | jq -r .state.recoveryKeyId)" = 'null'
test "$(
  printf '%s\n' "$FALCONE_RESTORE_STATUS" |
    jq '[.recent[] |
      select(
        .action == "adopt" and
        .state == "completed" and
        .affectedCount == .verifiedCount
      )
    ] | length'
)" -ge 1
unset FALCONE_RESTORE_STATUS
```

The literal checks above verify the service-proxied `/readyz` response, `serving`, legacy mode,
matching adoption affected/verified counts, and no recovery identity. P18 should review
[Read secret-safe lifecycle status](#read-secret-safe-lifecycle-status) for the complete output
contract.

Before cleanup, use two supported disposable logins to prove read-only public-contract and
cross-scope behavior through the restored control plane. Prepare:

- `FALCONE_RESTORE_TENANT_A_CURL_CONFIG` and `FALCONE_RESTORE_TENANT_B_CURL_CONFIG`, mode `0600`
  curl config files produced by the supported disposable superadmin/user flow. Each file contains
  only its login's `Authorization` header; never print, attach, or pass the token in an argument;
- `FALCONE_RESTORE_WORKSPACE_A`, a real workspace visible to tenant A and outside tenant B;
- `FALCONE_RESTORE_LOCAL_PORT`, an unused loopback port.

The smoke reads event types and subscription inventory as tenant A, rejects tenant B at tenant A's
workspace boundary, retains response bodies only in a mode-`0700` temporary directory, and emits
only bounded status/count evidence:

```bash
test -r "$FALCONE_RESTORE_TENANT_A_CURL_CONFIG"
test -r "$FALCONE_RESTORE_TENANT_B_CURL_CONFIG"
test "$(stat -c '%a' "$FALCONE_RESTORE_TENANT_A_CURL_CONFIG")" = '600'
test "$(stat -c '%a' "$FALCONE_RESTORE_TENANT_B_CURL_CONFIG")" = '600'
test -n "$FALCONE_RESTORE_WORKSPACE_A"
test -n "$FALCONE_RESTORE_LOCAL_PORT"

FALCONE_RESTORE_PARITY_DIR="$(mktemp -d /tmp/falcone-c25-parity.XXXXXX)"
chmod 0700 "$FALCONE_RESTORE_PARITY_DIR"
FALCONE_RESTORE_PORT_FORWARD_LOG="${FALCONE_RESTORE_PARITY_DIR}/port-forward.log"

kubectl --context "$FALCONE_RESTORE_CONTEXT" \
  --namespace "$FALCONE_RESTORE_NAMESPACE" port-forward \
  "service/${FALCONE_RESTORE_RELEASE}-control-plane" \
  "${FALCONE_RESTORE_LOCAL_PORT}:http" \
  >"$FALCONE_RESTORE_PORT_FORWARD_LOG" 2>&1 &
FALCONE_RESTORE_PORT_FORWARD_PID=$!

cleanup_webhook_parity() {
  if kill -0 "$FALCONE_RESTORE_PORT_FORWARD_PID" >/dev/null 2>&1; then
    kill "$FALCONE_RESTORE_PORT_FORWARD_PID"
    wait "$FALCONE_RESTORE_PORT_FORWARD_PID" 2>/dev/null || true
  fi
  rm -rf "$FALCONE_RESTORE_PARITY_DIR"
}
trap 'cleanup_webhook_parity; cleanup_webhook_kube_restore' EXIT HUP INT TERM

FALCONE_RESTORE_API_BASE="http://127.0.0.1:${FALCONE_RESTORE_LOCAL_PORT}"
until curl --silent --show-error --fail \
  "${FALCONE_RESTORE_API_BASE}/readyz" >/dev/null; do
  kill -0 "$FALCONE_RESTORE_PORT_FORWARD_PID"
  sleep 1
done

FALCONE_RESTORE_EVENT_TYPES_STATUS="$(
  curl --config "$FALCONE_RESTORE_TENANT_A_CURL_CONFIG" \
    --silent --show-error \
    --output "${FALCONE_RESTORE_PARITY_DIR}/event-types.json" \
    --write-out '%{http_code}' \
    "${FALCONE_RESTORE_API_BASE}/v1/workspaces/${FALCONE_RESTORE_WORKSPACE_A}/webhooks/event-types"
)"
test "$FALCONE_RESTORE_EVENT_TYPES_STATUS" = '200'
test "$(
  jq 'if (.eventTypes | type) == "array" then (.eventTypes | length)
      else -1 end' \
    "${FALCONE_RESTORE_PARITY_DIR}/event-types.json"
)" -ge 0

FALCONE_RESTORE_OWN_LIST_STATUS="$(
  curl --config "$FALCONE_RESTORE_TENANT_A_CURL_CONFIG" \
    --silent --show-error \
    --output "${FALCONE_RESTORE_PARITY_DIR}/own-list.json" \
    --write-out '%{http_code}' \
    "${FALCONE_RESTORE_API_BASE}/v1/workspaces/${FALCONE_RESTORE_WORKSPACE_A}/webhooks/subscriptions"
)"
test "$FALCONE_RESTORE_OWN_LIST_STATUS" = '200'
FALCONE_RESTORE_OWN_COUNT="$(
  jq 'if (.items | type) == "array" then (.items | length) else -1 end' \
    "${FALCONE_RESTORE_PARITY_DIR}/own-list.json"
)"
test "$FALCONE_RESTORE_OWN_COUNT" -ge 0

FALCONE_RESTORE_CROSS_SCOPE_STATUS="$(
  curl --config "$FALCONE_RESTORE_TENANT_B_CURL_CONFIG" \
    --silent --show-error \
    --output "${FALCONE_RESTORE_PARITY_DIR}/cross-scope.json" \
    --write-out '%{http_code}' \
    "${FALCONE_RESTORE_API_BASE}/v1/workspaces/${FALCONE_RESTORE_WORKSPACE_A}/webhooks/subscriptions"
)"
case "$FALCONE_RESTORE_CROSS_SCOPE_STATUS" in
  403|404) ;;
  *) printf '%s\n' 'restored-copy cross-scope request did not fail closed' >&2; exit 1 ;;
esac

FALCONE_RESTORE_PARITY_VERIFIED=true
export FALCONE_RESTORE_PARITY_VERIFIED
printf 'tenant/public parity verified: ownRoutes=2 ownItems=%s crossScope=1\n' \
  "$FALCONE_RESTORE_OWN_COUNT"
unset FALCONE_RESTORE_EVENT_TYPES_STATUS FALCONE_RESTORE_OWN_LIST_STATUS
unset FALCONE_RESTORE_OWN_COUNT FALCONE_RESTORE_CROSS_SCOPE_STATUS
```

Expected evidence is one bounded line with `ownRoutes=2` and `crossScope=1`; no token, response
body, tenant/workspace identifier, subscription ID, or payload is printed. Any failed assertion
leaves the release gate failed while the trap still removes the temporary responses, port-forward,
Helm release, and namespace.

Always clean up the disposable release and restored provider instance after preserving only the
bounded pass/fail evidence and the provider backup/clone ID. For the bundled procedure, invoke the
already-installed cleanup trap explicitly, then remove it:

```bash
test "$FALCONE_RESTORE_PARITY_VERIFIED" = 'true'
cleanup_webhook_parity
cleanup_webhook_kube_restore
trap - EXIT HUP INT TERM
unset FALCONE_SOURCE_INVENTORY FALCONE_RESTORE_PARITY_VERIFIED
```

For a managed provider, delete the isolated restored instance through the provider's approved
workflow and verify deletion separately. If the provider cannot create an isolated clone, if the
chart cannot target it through an already-supported database contract, or if teardown cannot be
proved, the restore gate remains incomplete; do not substitute `pg_restore --list` or use the source
database.

### Back up key custody without exporting it as evidence

For a managed Secret, take an encrypted namespace/etcd backup through the approved cluster backup
system. For an external Secret, retain the exact manager version. Do not use a raw Secret YAML/JSON
file as an evidence attachment.

Derive and record the non-secret opaque identity without reading the Secret:

```bash
export FALCONE_CURRENT_SECRET='<current-secret-name>'
export FALCONE_CURRENT_SECRET_KEY='<current-data-key-name>'

export FALCONE_CURRENT_KEY_ID="wk1:$(
  printf '%s/%s/%s' \
    "$FALCONE_NAMESPACE" \
    "$FALCONE_CURRENT_SECRET" \
    "$FALCONE_CURRENT_SECRET_KEY" |
    sha256sum | awk '{print $1}'
)"

printf 'current key identity: %s\n' "$FALCONE_CURRENT_KEY_ID"
```

Record this ID next to:

- database backup ID/path and checksum;
- Kubernetes/etcd backup ID or external-manager version ID;
- namespace, Secret name, data-key name, and custody mode;
- maintenance request, timestamp, and restore-test result.

Do not record key bytes, canonical text, base64 data, ciphertext, IV, or a digest of key bytes.

## Fresh managed install

Use this path only for a new database with no existing webhook signing-secret rows. Put this
reference-only block in `FALCONE_KEY_VALUES`:

```yaml
global:
  webhookSigningKey:
    create: true
    secretName: <new-managed-secret-name>
    secretKey: <data-key-name>
    adoption:
      mode: none
      requestId: ""
    rotation:
      action: none
      requestId: ""
      sourceSecretName: ""
      sourceSecretKey: ""
      rotationId: ""
      recoveryWindowSeconds: 604800
```

The credential hook generates exactly 32 random bytes in-cluster, formats canonical-v1, and creates
an immutable, Helm-retained Secret. Helm never receives the bytes.

Validate and install:

```bash
helm lint "$FALCONE_CHART" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_KEY_VALUES"

helm upgrade --install "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_KEY_VALUES" \
  --wait --timeout 20m
```

Expected state:

- the pre-install credential hook creates the missing managed Secret and is deleted after success;
- the Secret is immutable, release-owned, annotated `helm.sh/resource-policy: keep`, and not stored
  in Helm manifests/history;
- before application DDL, a separate PostgreSQL authority-bootstrap Job is the only workload that
  receives the bundled administrator Secret; it creates/validates four bounded LOGINs and the three
  fixed NOLOGIN authorities, persists reusable credentials, and establishes only
  `falcone_app` → runtime (`ADMIN FALSE, INHERIT TRUE, SET FALSE`),
  `falcone_webhook_key_writer` → writer
  (`ADMIN FALSE, INHERIT FALSE, SET TRUE`), and
  `falcone_webhook_key_lifecycle` → lifecycle
  (`ADMIN FALSE, INHERIT FALSE, SET TRUE`), all recorded under one declared durable administrator
  grantor;
- the control-plane receives four Secret-backed, TLS-verifying webhook-only DSNs in addition to its
  unchanged global `DB_URL`/`PG*` DSN, but never the administrator credential; schema startup proves
  five distinct authenticated application sessions and exact ownership/role edges, applies only
  webhook migration `004` through the schema pool, and closes that pool;
- tenant/workspace, saga, governance, saga recovery, and workspace-database creation remain on the
  existing global pool; ordinary webhook adapters use only `WEBHOOK_RUNTIME_DATABASE_URL`, encrypted
  writes use only `WEBHOOK_KEY_WRITE_DATABASE_URL`, and startup key verification uses and then closes
  `WEBHOOK_KEY_LIFECYCLE_DATABASE_URL`;
- the control-plane Deployment references the Secret with `optional: false`;
- startup creates canonical serving state only when the database has no legacy rows;
- the Deployment rolls out and `/readyz` becomes available only after verification.

Verify without reading Secret data:

```bash
kubectl --namespace "$FALCONE_NAMESPACE" rollout status \
  "deployment/${FALCONE_CONTROL_PLANE}" --timeout=5m

kubectl --namespace "$FALCONE_NAMESPACE" get secret '<new-managed-secret-name>' \
  -o go-template='name={{.metadata.name}}{{" immutable="}}{{.immutable}}{{" managed="}}{{index .metadata.labels "in-falcone.io/webhook-key-managed"}}{{" key-id="}}{{index .metadata.annotations "in-falcone.io/webhook-key-id"}}{{"\n"}}'
```

Expected metadata is `immutable=true`, `managed=true`, and an opaque `wk1:` identity. Never append a
template expression that selects `.data`.

## Fresh install with external custody

The external manager must generate and retain strict canonical-v1 material and create the named
Kubernetes Secret before Helm runs. Falcone does not add a KMS, ESO, Vault/OpenBao, or other manager
integration for this key; `create: false` is a generic read-only Kubernetes Secret contract.

Preferred path: configure the approved manager/controller to create a new Secret name and data-key
name in `FALCONE_NAMESPACE`, then check only the object inventory:

```bash
kubectl --namespace "$FALCONE_NAMESPACE" get secret '<external-secret-name>'
```

If policy permits a direct Kubernetes create from a protected custody file, the bytes stay out of
arguments, history, stdout, YAML, and Helm:

```bash
set +x
export FALCONE_CUSTODY_FILE='<protected-path-provided-by-approved-custody-workflow>'
export FALCONE_EXTERNAL_SECRET='<external-secret-name>'
export FALCONE_EXTERNAL_SECRET_KEY='<data-key-name>'

test -r "$FALCONE_CUSTODY_FILE"
kubectl --namespace "$FALCONE_NAMESPACE" create secret generic "$FALCONE_EXTERNAL_SECRET" \
  --from-file="${FALCONE_EXTERNAL_SECRET_KEY}=${FALCONE_CUSTODY_FILE}"
unset FALCONE_CUSTODY_FILE
```

This command does not validate canonical format locally; the chart's read-only credential hook does
so and fails closed before rollout. Do not use `--from-literal`, `--dry-run ... -o yaml`, or a pipe
that prints/records the input.

Use reference-only values:

```yaml
global:
  webhookSigningKey:
    create: false
    secretName: <external-secret-name>
    secretKey: <data-key-name>
    adoption:
      mode: none
      requestId: ""
    rotation:
      action: none
      requestId: ""
      sourceSecretName: ""
      sourceSecretKey: ""
      rotationId: ""
      recoveryWindowSeconds: 604800
```

Run the same lint/install/rollout/status checks as the managed path. Expected credential output is
external custody with `created: false`; the hook has only `get` Secret permission and does not add
labels, annotations, immutability, ownership, or retention policy.

## Validate every lifecycle upgrade

Adoption, rotation, recovery, and finalization are upgrade-only. `helm lint` has no upgrade mode, so
never pass an adoption or non-`none` rotation action to it. Keep `FALCONE_KEY_VALUES` install-shaped
or steady-state (`adoption.mode: none`, `rotation.action: none`) and save the complete current action
block in `FALCONE_ACTION_KEY_VALUES`.

Define this validator once in the same shell used for the maintenance procedure:

```bash
validate_webhook_lifecycle_upgrade() {
  expected_source_version="$1"
  expected_first_handoff="$2"

  case "$expected_first_handoff" in
    true|false) ;;
    *) printf '%s\n' 'first-handoff argument must be true or false' >&2; return 2 ;;
  esac
  test -n "$FALCONE_BACKUP_REFERENCE"

  FALCONE_INSTALLED_VERSION="$(
    helm list --namespace "$FALCONE_NAMESPACE" \
      --filter "^${FALCONE_RELEASE}$" --output json |
      jq -er --arg release "$FALCONE_RELEASE" '
        map(select(.name == $release)) |
        if length == 1
        then .[0].app_version
        else error("expected exactly one Helm-managed Falcone release")
        end
      '
  )"
  FALCONE_TARGET_VERSION="$(
    helm show chart "$FALCONE_CHART" |
      awk '$1 == "appVersion:" {
        gsub(/"/, "", $2)
        print $2
        exit
      }'
  )"
  export FALCONE_INSTALLED_VERSION FALCONE_TARGET_VERSION

  test "$FALCONE_INSTALLED_VERSION" = "$expected_source_version"
  test "$FALCONE_TARGET_VERSION" = '0.3.1'

  helm lint "$FALCONE_CHART" \
    --values "$FALCONE_BASE_VALUES" \
    --values "$FALCONE_KEY_VALUES"

  helm template "$FALCONE_RELEASE" "$FALCONE_CHART" \
    --namespace "$FALCONE_NAMESPACE" \
    --is-upgrade \
    --values "$FALCONE_BASE_VALUES" \
    --values "$FALCONE_ACTION_KEY_VALUES" \
    --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
    --set "global.webhookDatabase.migration.firstHandoff=${expected_first_handoff}" \
    --set global.webhookDatabase.migration.backupVerified=true \
    --set global.webhookDatabase.migration.parityVerified=true \
    --set-string \
      "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
    >/dev/null

  helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
    --namespace "$FALCONE_NAMESPACE" \
    --values "$FALCONE_BASE_VALUES" \
    --values "$FALCONE_ACTION_KEY_VALUES" \
    --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
    --set "global.webhookDatabase.migration.firstHandoff=${expected_first_handoff}" \
    --set global.webhookDatabase.migration.backupVerified=true \
    --set global.webhookDatabase.migration.parityVerified=true \
    --set-string \
      "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
    --dry-run=server --hide-secret >/dev/null

  test -f "$FALCONE_CHART_SOURCE/tests/webhook-signing-key-chart.test.mjs"
  (
    cd "$FALCONE_CHART_SOURCE"
    node --test tests/webhook-signing-key-chart.test.mjs
  )
}
```

Expected result: the install/steady-state lint, action-specific client render, Secret-hidden
server-side dry-run, exact installed source-version check, chart `0.3.1` target check, and focused
chart lifecycle suite all succeed.
The target version is the selected chart's `appVersion`; `deployment.upgrade.currentVersion` is the
truthful installed source. Do not falsify either side of that pair. The chart does not define a
`deployment.upgrade.targetVersion` value, so do not invent one.

## Legacy adoption from a pre-0.3.1 deployment

Adoption labels existing rows with the historical opaque identity and establishes legacy serving
state. It does **not** rotate to canonical material. This procedure applies only when `helm list`
finds exactly one already Helm-managed Falcone release. It is not a migration path for the frozen
manual OpenShift `0.3.0` manifests.

### Adoption preflight

1. Confirm the published matched 0.3.1 image/chart pair and exact installed pre-0.3.1 version.
2. Declare an outage-capable maintenance window. The hook scales the chart-owned control-plane
   Deployment to zero and waits up to 120 seconds for reported replicas and available replicas to
   reach zero.
3. Identify every out-of-chart process that can encrypt/decrypt these rows and stop it separately.
   The chart hook drains only the chart-owned control-plane Deployment.
4. Disable automation that can scale or roll the control plane during the hook.
5. Take and restore-test the PostgreSQL backup; retain the matching historical Secret custody.
6. Obtain the exact historical bytes from the approved original custody source without printing
   Helm history, workload environment, or process environment.
7. Provision those exact bytes as an **external** Kubernetes Secret. Legacy material cannot be
   chart-generated.
8. Choose a unique adoption request ID and do not reuse it for another binding.

Provisioning from a protected custody file uses the external create procedure above. The literal
bytes may be arbitrary legacy text; do not trim, add, remove, recode, or add a newline.

Save upgrade values like these in `FALCONE_ACTION_KEY_VALUES`, replacing every placeholder:

```yaml
global:
  webhookSigningKey:
    create: false
    secretName: <legacy-external-secret-name>
    secretKey: <legacy-data-key-name>
    adoption:
      mode: legacy
      requestId: <unique-adoption-request-id>
    rotation:
      action: none
      requestId: ""
      sourceSecretName: ""
      sourceSecretKey: ""
      rotationId: ""
      recoveryWindowSeconds: 604800
```

Preview schema/template validity, but do not save or attach a pre-C-25 release manifest or values
dump. The new values contain references only:

```bash
validate_webhook_lifecycle_upgrade '0.3.0' true
```

Use `0.2.0` instead only when `helm list` truthfully reports that source version. The selected target
chart remains `0.3.1`.

Apply the upgrade:

```bash
helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_ACTION_KEY_VALUES" \
  --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
  --set global.webhookDatabase.migration.firstHandoff=true \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

`firstHandoff=true` is authorized only for the initial pre-0.3.1 database-credential/ownership
handoff. After that first upgrade succeeds, retain the same legacy Secret reference and the same
adoption request ID, set `firstHandoff=false`, take and restore-test a current backup, update
`FALCONE_BACKUP_REFERENCE`, and use the exact same validation/apply procedure for an idempotent
replay:

```bash
validate_webhook_lifecycle_upgrade '0.3.1' false

helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_ACTION_KEY_VALUES" \
  --set-string deployment.upgrade.currentVersion=0.3.1 \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

Do not change the adoption request ID for that replay and do not add a rotation action. The retained
database-credential marker prevents regeneration. The chart-side
[Webhook Database Authority guide](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/WEBHOOK-DATABASE-AUTHORITY.md)
defines the same initial-handoff/replay boundary and bounded PostgreSQL ownership contract.

The credential hook first validates the external legacy Secret read-only. The upgrade-only lifecycle
hook then:

1. runs a separate, ordered PostgreSQL authority-bootstrap Job before any application DDL. Only this
   one-shot Job receives the bundled PostgreSQL administrator Secret. It creates or validates the
   distinct schema/runtime/writer/lifecycle LOGINs, creates or validates `falcone_app`,
   `falcone_webhook_key_lifecycle`, and `falcone_webhook_key_writer` as fixed `NOLOGIN`,
   non-superuser, non-`BYPASSRLS` authorities, repairs legacy memberships using one declared durable
   administrator grantor, and binds exactly `falcone_app` → runtime
   (`ADMIN FALSE, INHERIT TRUE, SET FALSE`), `falcone_webhook_key_writer` → writer
   (`ADMIN FALSE, INHERIT FALSE, SET TRUE`), and `falcone_webhook_key_lifecycle` → lifecycle
   (`ADMIN FALSE, INHERIT FALSE, SET TRUE`). PostgreSQL 16 or newer is required. For a legacy
   single-`falcone` database, the Job transfers only
   `webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, and
   `webhook_delivery_attempts` from the proven legacy owner to the new schema LOGIN before migration
   `004`. On replay or a partially completed prior attempt it additionally validates/transfers only
   `webhook_master_key_state`, `webhook_master_key_rotations`,
   `falcone_webhook_key_write_current_id()`,
   `falcone_webhook_signing_secret_write_statement_fence()`, and
   `falcone_webhook_signing_secret_write_fence()` when they already exist. It fails on any other
   current owner and never uses `REASSIGN OWNED`, so non-webhook control-plane ownership remains
   unchanged.
   Generated login passwords are persisted and reused in Secret data without entering rendered
   manifests, values, logs, Events, or command arguments. The administrator credential is never
   mounted into the control-plane Deployment or lifecycle Job;
2. authenticates the global control-plane session plus all four webhook-only application sessions
   before DDL. Each connection must begin with `session_user = current_user`; all five session users
   must be distinct. The webhook sessions are free of superuser, `BYPASSRLS`, `CREATEROLE`,
   `CREATEDB`, and replication authority. The global session remains separate and may retain its
   existing `CREATEDB` capability for workspace databases, but cannot be a fixed authority, webhook
   schema owner, writer, lifecycle principal, or declared grantor. A superuser/admin session with
   startup-role aliases is rejected. Tenant/workspace, saga, and governance schemas plus saga
   recovery run through that unchanged global pool; the bounded schema login applies only the
   additive, idempotent webhook schema set, including migration `004`, before Kubernetes
   quiescence. This schema step creates nullable lifecycle metadata and tables and installs the
   non-transforming shared/exclusive database write fence. Installing the trigger waits for any
   pre-existing legacy row-writing transaction to finish before migration completion. Once the
   trigger is active, a legacy writer that lacks the dedicated writer authority fails closed rather
   than adding another unlabeled row; the hook proceeds directly to verified quiescence.
   The schema step does not label, decrypt, re-encrypt, or otherwise transform existing
   signing-secret rows. A schema failure therefore occurs before the hook changes the Deployment
   replica count. Migration `004` validates the pre-created global roles and fails with a bounded
   error when they or the graph are absent/invalid. It changes only object DDL and object
   privileges: it cannot create roles, bind memberships, or claim to revoke a role membership made
   by another grantor. It supplies ordinary runtime permissions in both FORCE-RLS-present and RLS-absent
   paths, while revoking runtime encrypted-column writes and lifecycle-table access. After DDL, the
   application re-authenticates the sessions; verifies the exact PostgreSQL 16 role
   options/grantor, object ACLs, absence of column grants, function execution, RLS mode, exact policy
   inventory/definitions, and schema ownership. For the six enumerated relations and three
   enumerated functions, the bounded object owner uses `CASCADE` at each exact object/grantee
   boundary so an alternate-grantor grant-option/downstream ACL chain cannot block replay or retain
   excess access. This does not touch a non-enumerated object or any role membership. The
   application then closes the schema pool. Ordinary webhook reads
   and mutations then use only the dedicated bounded runtime pool. Startup verification uses and
   closes the lifecycle pool; the global, webhook runtime, and webhook writer pools remain serving;
3. records the current replica count;
4. scales the control-plane Deployment to zero and verifies drain;
5. takes the PostgreSQL lifecycle advisory lock exclusively, after migration `004` has made every
   ordinary encrypted signing-secret insert/update take the matching shared transaction lock and
   validate the durable serving-key identity. The repository first executes
   `SET LOCAL ROLE falcone_webhook_key_lifecycle`, and the security-invoker trigger requires that
   effective role (or the inherently privileged effective table owner/superuser) in addition to the
   exclusive lock. Advisory-lock possession alone is never lifecycle authority: even a superuser
   session after `SET LOCAL ROLE falcone_app` is constrained as `falcone_app`. The lifecycle
   transaction uses a 15-second lock timeout and 30-minute statement timeout;
6. authenticates/decrypts every legacy row with the exact historical normalization;
7. atomically labels every row, creates the encrypted verification sentinel and legacy serving
   state, and records the sanitized ledger outcome;
8. lets the Helm upgrade roll the verified legacy-mode workload back to its declared replicas.

Any incompatible row rolls back the whole transformation transaction. A schema failure happens
before drain. On a later pre-commit failure after quiescence, the hook attempts to restore the
observed replica count. If replica restoration itself fails, Helm stays failed and the control plane
remains stopped; use [Incident response](#incident-response).

Verify `state.lifecycleState=serving`, `state.currentMode=legacy`, the expected opaque current ID,
and a completed adoption entry whose `affectedCount` equals `verifiedCount`. Keep the legacy adoption
values and exact request ID while legacy serving remains current: repeating the identical adoption
request is an idempotent ledger replay. Do not change the request ID merely because Helm is retried.

## Read secret-safe lifecycle status

The lifecycle status mode is an internal operator CLI, not an HTTP endpoint. It accepts no positional
arguments or flags; even `--help` is rejected, so select `status` only through the environment shown
below. Run it in a healthy, compatible control-plane pod.

The command first applies the additive, idempotent webhook schema set and then reads platform
lifecycle tables. On an already healthy compatible deployment the schema step is a no-op, but this is
not a no-database-write guarantee. Only P18 should invoke it. Its JSON does not read or return Secret
data, verification ciphertext/IV, SQL parameters, or plaintext.

The distinct lifecycle database LOGIN intentionally has no direct lifecycle-table access:
`INHERIT FALSE` prevents it from inheriting the fixed authority's grants. Resolution preflight,
status, and already-quiesced replay authorization each open a read-only transaction, execute
`SET LOCAL ROLE falcone_webhook_key_lifecycle`, read through that one leased connection, and then
commit or roll back before releasing it. The transaction-local role is cleared before the
connection returns to the pool. A direct query authenticated only as the lifecycle LOGIN is expected
to fail with SQLSTATE `42501`; do not add a direct grant, change `INHERIT`/`SET`, or substitute an
owner/administrator DSN to make status work.

```bash
kubectl --namespace "$FALCONE_NAMESPACE" exec \
  "deployment/${FALCONE_CONTROL_PLANE}" -- \
  env WEBHOOK_KEY_LIFECYCLE_ACTION=status \
  node /app/webhook-key-lifecycle-cli.mjs |
  jq .
```

The output shape is:

```json
{
  "configured": true,
  "state": {
    "lifecycleState": "serving",
    "currentKeyId": "wk1:<64-lowercase-hex>",
    "currentMode": "canonical-v1",
    "currentManaged": true,
    "recoveryKeyId": "wk1:<64-lowercase-hex-or-null>",
    "recoveryMode": "<canonical-v1-legacy-or-null>",
    "recoveryManaged": "<boolean-or-null>",
    "recoveryDeadline": "<timestamp-or-null>",
    "activeRequestId": "<request-id-or-null>",
    "activeRotationId": "<rotation-id-or-null>",
    "updatedAt": "<timestamp>"
  },
  "recent": [
    {
      "action": "rotate",
      "requestId": "<request-id>",
      "rotationId": "<rotation-id-or-null>",
      "sourceKeyId": "wk1:<64-lowercase-hex-or-null>",
      "targetKeyId": "wk1:<64-lowercase-hex-or-null>",
      "sourceManaged": "<boolean-or-null>",
      "targetManaged": "<boolean-or-null>",
      "state": "completed",
      "affectedCount": 0,
      "verifiedCount": 0,
      "recoveryDeadline": "<timestamp-or-null>",
      "errorCode": null
    }
  ]
}
```

`recent` contains at most 20 entries. Counts in the shape are placeholders, not expected production
values. A healthy state is `serving`; rotation/adoption rows should have matching affected/verified
counts. A recovery identity is expected after rotate/recover and must remain available until
finalization.

Pod `exec` is powerful and can expose environment-delivered credentials through other commands. Do
not grant it to P4/P10 merely to run status. A P18 operator should capture the exact sanitized output
and hand off the bounded evidence file.

If no healthy pod exists because startup failed closed, status-via-exec is unavailable. Inspect only
the retained failed hook's sanitized log and retry/recover with the fixed chart; do not create an
unreviewed debug pod with broad Secret or database access.

## Canonical rotation

Rotation is a separate maintenance upgrade after adoption and stable service. One existing recovery
identity is not allowed: recover or finalize it before starting another rotation.

### Prepare a new target identity

Choose a new Secret name or data-key name. It must differ from the source pair.

- Managed target: set `create: true`; the credential hook generates a missing canonical-v1 Secret
  only because action is `rotate`. If that managed name already exists, it must be the exact
  immutable Secret owned by this release.
- External target: set `create: false`; provision canonical-v1 material at the new identity before
  Helm runs. The external manager must not mutate the source identity in place.

Before rotation:

1. complete the context, backup, custody, maintenance, external-consumer, and automation checks from
   adoption;
2. record current desired replicas and current secret-safe status;
3. verify the source Secret is retained and restorable for the entire recovery window;
4. choose a new unique request ID and new unique rotation ID;
5. choose 300–2,592,000 recovery seconds and schedule finalization at or immediately after its
   deadline;
6. leave enough Helm timeout for the 30-minute transaction limit plus drain and rollout.

Save these example managed-target values after legacy adoption in
`FALCONE_ACTION_KEY_VALUES`:

```yaml
global:
  webhookSigningKey:
    create: true
    secretName: <new-managed-canonical-secret-name>
    secretKey: <new-data-key-name>
    adoption:
      mode: legacy
      requestId: <original-adoption-request-id>
    rotation:
      action: rotate
      requestId: <unique-rotation-request-id>
      sourceSecretName: <legacy-external-secret-name>
      sourceSecretKey: <legacy-data-key-name>
      rotationId: <unique-rotation-id>
      recoveryWindowSeconds: 604800
```

For a canonical source, set `adoption.mode: none` and its request ID to empty. For an external
target, change only `create: false` after provisioning the strict canonical target.

Validate the installed chart `0.3.1` to target chart `0.3.1` pair, then apply the action-specific
upgrade:

```bash
validate_webhook_lifecycle_upgrade '0.3.1' false

helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_ACTION_KEY_VALUES" \
  --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

The lifecycle hook drains, locks, decrypts every row with the recorded source, re-encrypts the same
plaintext with fresh IVs under the canonical target, verifies it, and commits all rows/state/counts/
deadline in one transaction.

After success, create a reference-only steady-state values revision with:

- current `secretName`/`secretKey` set to the canonical target;
- `create` matching target custody;
- `adoption.mode: none` and empty adoption request ID;
- `rotation.action: none` and all rotation IDs/source fields empty;
- the same recovery window default (it is inactive when action is none).

When chart `0.3.1` is the installed version, save the cleanup as `FALCONE_KEY_VALUES`, remove the
action file from the command, and validate/apply the action-none upgrade:

```bash
helm lint "$FALCONE_CHART" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_KEY_VALUES"

helm template "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --is-upgrade \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_KEY_VALUES" \
  --set-string deployment.upgrade.currentVersion=0.3.1 \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  >/dev/null

helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_KEY_VALUES" \
  --set-string deployment.upgrade.currentVersion=0.3.1 \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

This cleanup does not change key bytes or lifecycle state; it prevents later unrelated upgrades from
replaying the maintenance hook. If a different version is installed, first confirm that the selected
chart truthfully lists it in `supportedPreviousVersions`.

Verify:

- control-plane rollout and `/readyz` succeed;
- status is `serving`, current mode `canonical-v1`, current ID equals the new reference, and recovery
  ID equals the old source reference;
- `affectedCount == verifiedCount` for the completed rotate entry;
- the deadline is future and both current and recovery custody are retained;
- tenant-scoped webhook management and known webhook signature verification remain unchanged;
- no public API, role, quota, tenant/workspace ownership, or per-subscription secret state changed.

## Retry and ambiguous-outcome rules

Request and rotation IDs are durable idempotency bindings.

- Retry an operation with the **same** action, request ID, rotation ID, source/target identities,
  modes, declared target custody, and recovery window. A completed identical operation returns the
  existing outcome.
- A failed pre-commit operation may be retried with its exact binding after fixing the cause; no
  partial row transaction is retained.
- Never reuse a request ID for changed fields. Falcone returns
  `WEBHOOK_LIFECYCLE_REQUEST_CONFLICT`.
- Never reuse a rotation ID for another request. Falcone returns
  `WEBHOOK_ROTATION_ID_CONFLICT`.
- If commit acknowledgement is lost, Falcone records `recovery_required` when it can prove the
  target commit. Both source and target serving fail closed.
- First rerun the exact original rotate request. It reconciles the ledger, sentinel, target row
  identities, and counts and can resume the committed target idempotently. This exact Helm retry is
  also accepted when the previous hook already left the Deployment fully drained at zero replicas;
  a new, failed-only, unbound, or conflicting request at zero remains fail closed. A reconciled hook
  returns `workloadAction: apply-target`, succeeds without a second row transform, and lets Helm apply
  the target-reference Deployment.
- If exact replay cannot establish a safe target, use explicit forward `recover`. Never scale an old
  workload up based only on a failed Helm status and never use historical Helm rollback.

## Forward recovery

Recovery re-encrypts the database from the current identity to the retained recovery identity through
the fixed chart. It swaps the identities and establishes a new recovery deadline; it is not a Helm
rollback.

Treat the recorded recovery deadline as the authorization boundary. Plan recovery before it expires.
The recovery transaction uses one injected/transaction-consistent clock and accepts recovery only
strictly before the deadline. At the exact deadline and afterward it returns
`WEBHOOK_RECOVERY_WINDOW_EXPIRED` before changing any row. Startup also rejects the unfinalized
expired state; use the incident/escalation process and do not treat a client-side render as
authorization to recover.

Prerequisites:

- status or the original operation evidence identifies current and recovery opaque IDs;
- both current and recovery Secret versions are in matching custody;
- the database state has not been manually altered;
- the current key can verify/decrypt current rows and the recovery sentinel is present;
- a fresh tested backup and maintenance window are approved;
- source and target Secret references are distinct;
- the request ID and rotation ID are new.

Save this example recovery from a canonical current identity to an externally held legacy recovery
identity in `FALCONE_ACTION_KEY_VALUES`:

```yaml
global:
  webhookSigningKey:
    create: false
    secretName: <legacy-recovery-secret-name>
    secretKey: <legacy-recovery-data-key-name>
    adoption:
      mode: legacy
      requestId: <original-adoption-request-id>
    rotation:
      action: recover
      requestId: <unique-recovery-request-id>
      sourceSecretName: <current-canonical-secret-name>
      sourceSecretKey: <current-canonical-data-key-name>
      rotationId: <unique-recovery-rotation-id>
      recoveryWindowSeconds: 604800
```

For a canonical recovery target, set adoption mode to `none` and its request ID empty. `create` must
describe the target/recovery Secret's original custody; it does not transfer ownership. Durable
lifecycle state is authoritative: if `create` disagrees with the recorded recovery custody, Falcone
returns `WEBHOOK_KEY_CUSTODY_CONFLICT` before locking or transforming a signing-secret row and leaves
current/recovery state unchanged. On success, the recovered current and newly retained recovery
custody values are swapped from their durable pre-recovery state rather than relabeled from Helm
values.

Validate the installed chart `0.3.1` to target chart `0.3.1` pair, then apply the action-specific
upgrade:

```bash
validate_webhook_lifecycle_upgrade '0.3.1' false

helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_ACTION_KEY_VALUES" \
  --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

Then verify serving mode and opaque IDs have swapped, counts match, and the new recovery deadline is
future. If the recovered current identity is legacy, retain the explicit legacy values and exact
adoption ID until a later canonical rotation; identical replays are idempotent.

## Finalize recovery retention

Finalization is destructive for an eligible managed recovery Secret. It is permitted only when all
of these are true:

- the recovery deadline has elapsed;
- current lifecycle state is verified `serving`;
- the current identity has been stable through tenant/public regression checks;
- the database backup and matching-key restore/recovery rehearsal succeeded;
- the source fields identify the exact non-current recovery Secret;
- a new finalization request ID is approved;
- no restore point under retention still depends on the recovery identity, or custody policy retains
  a separate protected copy.

Schedule finalization immediately after the deadline. A control-plane restart after the deadline but
before finalization fails closed with `WEBHOOK_RECOVERY_WINDOW_EXPIRED`.

Save these example values in `FALCONE_ACTION_KEY_VALUES`:

```yaml
global:
  webhookSigningKey:
    create: <true-for-managed-current-false-for-external-current>
    secretName: <current-secret-name>
    secretKey: <current-data-key-name>
    adoption:
      mode: none
      requestId: ""
    rotation:
      action: finalize
      requestId: <unique-finalization-request-id>
      sourceSecretName: <recovery-secret-name>
      sourceSecretKey: <recovery-data-key-name>
      rotationId: ""
      recoveryWindowSeconds: 604800
```

If the verified current identity is legacy, keep `adoption.mode: legacy`, its original adoption
request ID, and `create: false` instead of the canonical-current fields shown above.

Validate the installed chart `0.3.1` to target chart `0.3.1` pair, then apply the action-specific
upgrade:

```bash
validate_webhook_lifecycle_upgrade '0.3.1' false

helm upgrade "$FALCONE_RELEASE" "$FALCONE_CHART" \
  --namespace "$FALCONE_NAMESPACE" \
  --values "$FALCONE_BASE_VALUES" \
  --values "$FALCONE_ACTION_KEY_VALUES" \
  --set-string "deployment.upgrade.currentVersion=${FALCONE_INSTALLED_VERSION}" \
  --set global.webhookDatabase.migration.firstHandoff=false \
  --set global.webhookDatabase.migration.backupVerified=true \
  --set global.webhookDatabase.migration.parityVerified=true \
  --set-string \
    "global.webhookDatabase.migration.backupReference=${FALCONE_BACKUP_REFERENCE}" \
  --wait --timeout 40m
```

Finalization first removes the recovery identity, mode, verification metadata, and deadline in one
database transaction, but only after locking the complete signing-secret row set, proving every row
has the verified current key ID, and verifying the current state/sentinel. A mixed or unlabeled row
rolls back finalization, retains all recovery metadata, and prevents managed credential deletion. It
then handles credential cleanup:

- a managed recovery Secret is deleted only when it is non-current, immutable, has the expected
  opaque ID, and carries the exact release ownership labels/annotations;
- a missing eligible managed recovery Secret is an idempotent no-op;
- an ownership or identity mismatch fails without deleting it;
- an externally managed recovery Secret is never fetched for deletion and is never deleted;
- the managed **current** Secret is never deleted;
- normal upgrade and Helm uninstall do not delete retained managed current/recovery Secrets.

If database finalization commits but managed Secret deletion fails, retry the exact same finalization
request after resolving the ownership/RBAC cause. The ledger replay is safe and credential deletion
is retried. For an external recovery Secret, remove or retain it only through the external manager's
approved process after Falcone reports `recoveryKeyId: null`; that deletion is outside the chart.

After success, save steady-state action-none values in `FALCONE_KEY_VALUES` and apply them with the
same lint/template/upgrade cleanup block used after rotation. Verify `recoveryKeyId`,
`recoveryMode`, `recoveryManaged`, and `recoveryDeadline` are null, and retain the current Secret.

## Restore and key coupling

Always restore the database state tables, rotation ledger, and `webhook_signing_secrets` rows as one
consistent PostgreSQL backup. Never restore only ciphertext rows or manually edit key IDs/state.

After a restore:

1. keep all control-plane consumers stopped;
2. determine the restored `current_key_id`, mode, and any recovery identity from the backup's bounded
   non-secret inventory and matching custody record; status-via-exec is available only after a pod
   passes the startup gate;
3. map that opaque ID to the retained namespace/Secret/data-key custody record;
4. configure the fixed compatible chart to reference that exact current identity and mode;
5. if the restored state is pre-rotation legacy serving, replay the original adoption binding and
   later perform a fresh canonical rotation;
6. if the restored state contains an available recovery relationship, use the fixed chart's exact
   replay or forward-recover flow as appropriate;
7. start only after the startup gate verifies the sentinel, state, mode, identity, and every row;
8. capture only sanitized IDs/state/counts and repeat tenant/public verification.

Restoring post-rotation ciphertext while providing the pre-rotation key, or restoring pre-rotation
ciphertext while the chart points at the later key, fails closed. Losing the matching Secret bytes is
not repairable from the opaque ID, verification ciphertext, Helm values, or database alone.

The generic platform `backup-kv.sh` archive can contain Kubernetes Secret data and is therefore a
restricted recovery artifact, not audit evidence. It also does not replace the PostgreSQL backup.
Do not use its optional Helm-rollback path across this key transition.

## Helm history and rollback cautions

Pre-C-25 Helm release Secrets may permanently contain the old literal value. The new chart cannot
erase historical revisions.

- Restrict access to Helm release Secrets and backups according to secret-custody policy.
- Inventory and expire unsafe historical revisions only through your approved Helm-history retention
  procedure. Do not attach their contents to evidence.
- Never run `helm rollback` to a revision that renders `WEBHOOK_SIGNING_KEY` as `env.value`.
- Never roll the application image back across a committed database key transition.
- Use exact-request replay or `rotation.action: recover` with the fixed chart.
- A normal chart rollback is not a database rollback and cannot make mismatched ciphertext/key state
  safe.

## Collect audit and support evidence

P4/P10 evidence must contain only release identity, workload reference posture, non-secret rollout
annotations, lifecycle status, readiness, and bounded error codes. It must not contain a raw Secret,
raw workload, Helm values/manifest/history, pod environment, database rows, ciphertext, IV, tokens,
cookies, tenant payloads, PII, or logs unrelated to the lifecycle Job.

After a healthy rollout, a P18 operator can create a bounded file:

```bash
export FALCONE_EVIDENCE='<restricted-evidence-path>/webhook-key-posture.jsonl'
umask 077

{
  helm list --namespace "$FALCONE_NAMESPACE" \
    --filter "^${FALCONE_RELEASE}$" --output json |
    jq -c 'map({name,namespace,revision,status,chart,app_version,updated}) | .[]'

  kubectl --namespace "$FALCONE_NAMESPACE" get deployment "$FALCONE_CONTROL_PLANE" -o json |
    jq -c '{
      workload: .metadata.name,
      replicas: {desired: .spec.replicas, available: (.status.availableReplicas // 0)},
      keyReference: [
        .spec.template.spec.containers[].env[]
        | select(.name == "WEBHOOK_SIGNING_KEY")
        | {name, secretKeyRef: .valueFrom.secretKeyRef}
      ],
      lifecycleAnnotations: (
        .spec.template.metadata.annotations
        | with_entries(select(.key | startswith("in-falcone.io/webhook-key-")))
      )
    }'

  kubectl --namespace "$FALCONE_NAMESPACE" exec \
    "deployment/${FALCONE_CONTROL_PLANE}" -- \
    env WEBHOOK_KEY_LIFECYCLE_ACTION=status \
    node /app/webhook-key-lifecycle-cli.mjs |
    jq -c .

  kubectl --namespace "$FALCONE_NAMESPACE" exec "statefulset/${FALCONE_POSTGRES}" -- \
    sh -ec '
      set +x
      export PGPASSWORD="$POSTGRESQL_PASSWORD"
      psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
        --username="$POSTGRESQL_USERNAME" \
        --dbname="$POSTGRESQL_DATABASE" \
        --command="
          SELECT json_build_object(
            '"'"'eventId'"'"', id,
            '"'"'action'"'"', action_type,
            '"'"'actor'"'"', actor_id,
            '"'"'outcome'"'"', outcome,
            '"'"'requestId'"'"', correlation_id,
            '"'"'detail'"'"', new_state,
            '"'"'occurredAt'"'"', created_at,
            '"'"'prevHash'"'"', prev_hash,
            '"'"'rowHash'"'"', row_hash
          )
          FROM plan_audit_events
          WHERE tenant_id IS NULL
            AND actor_id = '"'"'falcone:platform-maintenance'"'"'
            AND action_type LIKE '"'"'webhook.master-key.%'"'"'
          ORDER BY created_at DESC, id DESC
          LIMIT 20"
    '
} > "$FALCONE_EVIDENCE"

chmod 0600 "$FALCONE_EVIDENCE"
```

Review before sharing:

```bash
test "$(jq -r 'select(.keyReference) | .keyReference | length' "$FALCONE_EVIDENCE")" = 1

if grep -Eq 'v1:[A-Za-z0-9_-]{43}' "$FALCONE_EVIDENCE"; then
  printf '%s\n' 'refusing evidence: canonical key-shaped data detected' >&2
  exit 1
fi
```

The key reference must contain `optional: false` and no `value`. The status entry must be `serving`.
For a completed mutation, verify affected and verified counts match, and correlate its request ID
with an internal `webhook.master-key.<action>` audit record. That record uses the platform-global
`falcone:platform-maintenance` actor/source and contains only opaque source/target identities, bounded
counts/state/deadline/error code, and outcome. Key IDs are safe opaque reference identities; do not
supplement them with key-byte hashes.

There is no new public audit endpoint or console surface for this lifecycle. The durable internal
ledger, established internal `plan_audit_events` writer/store, and CLI output provide correlated
counts/state evidence without a public schema change. A successful transform and its audit append
commit in the same database transaction; lost-ack reconciliation appends an explicit bounded
`recovery_required`/reconciled outcome. Existing logs expose only sanitized codes; do not infer that
arbitrary platform logs are safe to export without review.

## Incident response

### First response

1. Freeze Helm, GitOps, external-manager, autoscaler, and manual rollout changes for this release.
2. Preserve the current and recovery Secret versions and the latest pre-operation database backup.
3. Do not read, print, compare, hash, or copy key bytes into the incident channel.
4. Determine whether failure happened before commit, after/around commit, during rollout, at recovery
   expiry, or during finalization.
5. Inspect bounded resource state and only the named failed hook log.

```bash
helm list --namespace "$FALCONE_NAMESPACE" --filter "^${FALCONE_RELEASE}$"

kubectl --namespace "$FALCONE_NAMESPACE" get deployment "$FALCONE_CONTROL_PLANE" \
  -o jsonpath='{.metadata.name}{" desired="}{.spec.replicas}{" available="}{.status.availableReplicas}{" updated="}{.status.updatedReplicas}{"\n"}'

kubectl --namespace "$FALCONE_NAMESPACE" get jobs,pods \
  -l app.kubernetes.io/component=webhook-key-lifecycle
```

Failed hooks are retained. Successful hooks are deleted, so absence is not proof that a hook never
ran. Do not construct the Job name: the chart includes `global.nameOverride` in the fullname and
truncates it to 63 characters. Resolve exactly one retained failed Job by its component label.

Read only the failed container's bounded, sanitized output:

```bash
export FALCONE_LIFECYCLE_JOB="$(
  kubectl --namespace "$FALCONE_NAMESPACE" get jobs \
    -l app.kubernetes.io/component=webhook-key-lifecycle -o json |
    jq -er '
      if (.items | length) == 1
      then "job/\(.items[0].metadata.name)"
      else error("expected exactly one retained webhook lifecycle Job")
      end
    '
)"

kubectl --namespace "$FALCONE_NAMESPACE" logs \
  "$FALCONE_LIFECYCLE_JOB" \
  --container lifecycle --tail=20
```

If the earlier credential hook failed instead, use only its named container:

```bash
export FALCONE_CREDENTIAL_JOB="$(
  kubectl --namespace "$FALCONE_NAMESPACE" get jobs \
    -l app.kubernetes.io/component=webhook-key-credential -o json |
    jq -er '
      if (.items | length) == 1
      then "job/\(.items[0].metadata.name)"
      else error("expected exactly one retained webhook credential Job")
      end
    '
)"

kubectl --namespace "$FALCONE_NAMESPACE" logs \
  "$FALCONE_CREDENTIAL_JOB" \
  --container credential --tail=20
```

Expected CLI failure output is one JSON object with `status: failed` and a stable `CREDENTIAL_*`,
`WEBHOOK_*`, or `KUBE_*` code. Review it before attaching it to evidence.

### Safe responses by code/state

| Code or symptom | Meaning and safe response |
| --- | --- |
| `CREDENTIAL_EXTERNAL_SECRET_MISSING` | The external reference does not exist. Create/restore it through approved custody, without printing bytes, then retry the exact Helm request. |
| `CREDENTIAL_MANAGED_SECRET_MISSING` | A current managed Secret disappeared on ordinary upgrade. Do not regenerate it. Restore the exact retained Secret from encrypted custody. |
| `CREDENTIAL_MANAGED_OWNERSHIP_CONFLICT` | A managed name exists but immutability/release ownership does not match. Stop; do not claim, relabel, patch, or delete it. |
| `CREDENTIAL_MANAGED_IDENTITY_CONFLICT` | A managed Secret's required opaque identity annotation is absent or does not match its namespace/name/data-key reference. Stop; do not patch metadata or inspect data. Restore the exact retained chart-owned object from approved custody, or use a new target identity through the explicit lifecycle. |
| `CREDENTIAL_SECRET_KEY_MISSING`, `WEBHOOK_KEY_MISSING` | The referenced data key is absent or empty. Do not print the object. Correct/restore it through matching custody, then retry the exact binding. |
| `CREDENTIAL_LEGACY_GENERATION_FORBIDDEN` | The chart was asked to generate legacy bytes. Set external custody and provision the exact historical bytes; never synthesize a replacement. |
| `CREDENTIAL_MODE_INVALID`, `WEBHOOK_KEY_MODE_INVALID`, `WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED` | Mode and lifecycle state do not authorize the supplied material. Stop; reconcile chart values with status/backup custody instead of changing bytes or bypassing validation. |
| `CREDENTIAL_INPUT_INVALID`, `CREDENTIAL_ACTION_INVALID`, `CREDENTIAL_ARGUMENTS_FORBIDDEN`, `WEBHOOK_LIFECYCLE_INPUT_INVALID`, `WEBHOOK_LIFECYCLE_ARGUMENTS_FORBIDDEN` | The internal hook/CLI contract is invalid. Re-run install/steady-state lint plus the action-specific `helm template --is-upgrade` and inspect only reference/action fields. Do not pass CLI flags or keys as arguments; escalate a chart/image mismatch. |
| `WEBHOOK_KEY_FORMAT_INVALID` | Canonical target/external material is malformed. Replace it only through a new, correctly provisioned external identity; never print it for diagnosis. A not-yet-current managed target may be abandoned only after the deletion checks below. |
| `WEBHOOK_POSTGRESQL_16_REQUIRED` | The database does not expose the PostgreSQL 16 membership-option contract. Keep the listener stopped and upgrade PostgreSQL through its supported backup/restore or in-place procedure before retrying C-25; do not weaken the verifier. |
| `WEBHOOK_DATABASE_PRINCIPALS_REQUIRED`, `WEBHOOK_DATABASE_PRINCIPALS_INVALID` | One or more global/schema/runtime/writer/lifecycle DSNs, declared LOGIN/grantor names, bounded role attributes, exact PostgreSQL 16 memberships, grantor, ownership, relation/column/function ACLs, RLS mode, or policy definitions do not match the contract. Keep the listener stopped. Re-run the chart's one-shot PostgreSQL authority bootstrap with its existing persisted credential Secret; never give the application administrator/CREATEROLE authority, replace global `DB_URL` with the webhook runtime DSN, or hide one privileged session behind startup roles. |
| `WEBHOOK_KEY_CONFIG_REQUIRED` | Required Secret-sourced material, mode, or opaque ID did not reach startup. Verify the matched chart/image and field-selected `secretKeyRef`; do not add a direct environment value. |
| `WEBHOOK_KEY_UNAVAILABLE` | Startup or an ordinary encrypted signing-secret write could not prove a stable current serving identity. Initial subscription creation places its parent row and active signing-secret row in one shared-fence transaction, so a rejected fence commits neither row, publishes no created event, and consumes no phantom quota slot. Per-subscription rotation uses the same distinct writer pool and shared-fence transaction; a stale identity changes neither the active nor grace rows, emits no rotation event, and returns the same bounded HTTP 503 response without SQLSTATE, constraint, key ID, ciphertext, IV, DSN, or exception-message detail. Keep the maintenance operation fail closed, wait for the matched target workload to pass startup verification, and retry the tenant operation through its normal API semantics. |
| `WEBHOOK_CREATE_FAILED` | The initial subscription/signing-secret transaction failed after validation. Both inserts roll back together and raw SQLSTATE, trigger, constraint, key, cipher, tenant/workspace, and resource-ID details are intentionally suppressed. Correct the underlying database condition from bounded operator evidence, then retry the same tenant operation; a quota-one retry is not blocked by a parent-only row. |
| `WEBHOOK_KEY_ID_INVALID`, `WEBHOOK_KEY_CONTEXT_INVALID` | The opaque reference identity/context is invalid. Reconcile namespace, Secret name, and data-key name through the fixed chart; never derive an ID from key bytes or edit database IDs. |
| `WEBHOOK_ADOPTION_REQUIRED` | Existing unlabeled rows need explicit legacy adoption with the exact historical key. |
| `WEBHOOK_KEY_VERIFICATION_FAILED` | Bytes at the reference do not match the database sentinel. For same-name external mutation, restore the exact prior manager version at that identity; do not treat the mutation as rotation. |
| `WEBHOOK_ROW_KEY_MISMATCH` | Row identities are mixed/unlabeled for the requested serving state. Keep consumers stopped, restore/reconcile from a consistent backup, and escalate; do not edit rows manually. |
| `WEBHOOK_KEY_STATE_AMBIGUOUS` or `recovery_required` | Serving safety cannot be proven. Retry the exact original request first; if it cannot reconcile, use explicit forward recovery with retained identities. Do not manually scale old pods. |
| `WEBHOOK_KEY_STATE_CONFLICT` | The supplied current identity/mode does not match durable state. Preserve both custody versions, inspect sanitized status/evidence, and correct references through an approved exact replay/recovery; do not edit state. |
| `WEBHOOK_KEY_CUSTODY_CONFLICT` | Declared target custody does not match the durable retained recovery identity. No row or lifecycle-state transform is authorized. Preserve both Secret versions, correct `create` to the recorded custody, and use a new request ID if the rejected request bound the wrong flag. |
| `WEBHOOK_KEY_IDENTITY_CONFLICT` | Source and target identities are the same. Stop before mutation and prepare a genuinely new target reference with new approved request/rotation IDs. |
| `WEBHOOK_CONSUMERS_NOT_QUIESCED` | The maintenance action did not receive a verified quiescence assertion. Keep consumers stopped and escalate a chart/CLI mismatch; do not invoke the repository directly. |
| `WEBHOOK_LIFECYCLE_REQUEST_CONFLICT` | A request ID is already bound to different fields. Use the exact original binding for retry, or a new ID for a genuinely new approved operation. |
| `WEBHOOK_ROTATION_ID_CONFLICT` | A rotation ID belongs to another request. Preserve the old ledger and issue a new ID for a genuinely new rotation. |
| `WEBHOOK_RECOVERY_NOT_AVAILABLE` | No matching recovery identity is available, or another recovery must be finalized before rotation. Do not guess a key/ref. |
| `WEBHOOK_FINALIZE_TOO_EARLY` | The recovery deadline has not elapsed. Retain both identities and reschedule finalization. |
| `WEBHOOK_RECOVERY_WINDOW_EXPIRED` | Startup requires explicit finalization of stable current state. Keep matching custody, execute the approved finalization path, and escalate if recovery is still required. |
| `CREDENTIAL_DELETE_CURRENT_FORBIDDEN`, `CREDENTIAL_RECOVERY_IDENTITY_CONFLICT` | Finalization targeted the current or wrong recovery identity. No Secret is safely deletable. Stop, preserve both, and reconcile status/source fields before an exact approved retry. |
| `KUBE_DRAIN_TIMEOUT` | The chart-owned Deployment did not report fully drained within 120 seconds. Check controllers and pod termination; retry only when all key consumers are quiesced. |
| `KUBE_DEPLOYMENT_MISSING`, `KUBE_DEPLOYMENT_STATE_INVALID` | The declared chart-owned consumer is absent or has an unsafe replica state. Freeze the operation and reconcile the exact release/workload; do not guess a replacement replica count. |
| `KUBE_CONFIG_UNAVAILABLE`, `KUBE_REQUEST_FAILED`, `KUBE_RESPONSE_INVALID`, `KUBE_HTTP_*` | In-cluster identity, API connectivity, RBAC, or the Kubernetes response failed. Preserve replica/key/database state, fix infrastructure/RBAC without changing lifecycle bindings, then retry only after commit outcome is known. |
| `WEBHOOK_LIFECYCLE_FAILED`, `WEBHOOK_KEY_BOOTSTRAP_FAILED`, `CREDENTIAL_OPERATION_FAILED` | A raw cause was intentionally collapsed. Preserve all key versions, database backup, replica state, and request IDs; escalate using only the bounded code and opaque identities. |
| Failed hook with control plane at zero | If failure is proven pre-commit, the old Deployment spec still references the source and the hook normally restores its observed replicas. If restoration failed, get incident approval before scaling it to the recorded count. If commit is ambiguous, do not scale it; replay/recover first. |
| CrashLoop with sanitized bootstrap code | The listener never opened. Fix/reconcile lifecycle state; do not bypass readiness, remove the key gate, or introduce a fallback. |

An external manager changing bytes at the same name produces the same opaque ID but fails sentinel
verification. Rotation cannot repair this after the old bytes are lost because current rows cannot be
decrypted. Restore the exact prior version at that reference, or restore a database/Secret pair from
matching custody.

For any sanitized `WEBHOOK_*`, `CREDENTIAL_*`, or `KUBE_*` code not listed above, preserve current and
recovery custody, database backup, observed replicas, and exact request bindings. Do not generate,
delete, relabel, patch, or print a Secret and do not change an idempotency binding. Escalate with only
the bounded code, release/context, opaque identities, and secret-safe status when available.

## Cleanup and deletion boundaries

- Remove temporary **non-secret** render/evidence working files according to evidence policy.
- Never delete the current Secret.
- Never delete either identity merely because `helm upgrade` failed; commit outcome may be ambiguous.
- A managed target created before a proven pre-commit failure is retained. Reusing it with the exact
  request is safe. If the operation is permanently abandoned, delete it manually only after status,
  ledger, rendered current reference, and backup inventory independently prove its opaque ID is
  neither current nor recovery. Record approval; the chart provides no automatic abandoned-target
  cleanup.
- Managed current and recovery Secrets have Helm keep policy and survive normal upgrade and
  uninstall.
- Finalization may delete only the exact eligible chart-managed, immutable, non-current recovery
  Secret after the deadline.
- External current/recovery Secrets are never mutated or deleted by the chart, including on
  finalization or uninstall. Their later retirement belongs to the external custody owner.
- Finalization removes recovery metadata. After it commits, ordinary application recovery with that
  identity is no longer available even if an external copy remains.

## Source of truth and related pages

Source-level provenance for lifecycle `v1`:

- chart contract: [`values.yaml`](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/values.yaml)
  and [`values.schema.json`](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/values.schema.json);
- chart validation and hooks: [`validate.yaml`](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/templates/validate.yaml)
  and [`webhook-key-lifecycle.yaml`](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/templates/webhook-key-lifecycle.yaml);
- control-plane injection: [`workload.yaml`](https://github.com/gntik-ai/falcone-charts/blob/main/charts/in-falcone/charts/component-wrapper/templates/workload.yaml);
- credential/lifecycle CLIs: [`webhook-key-credential-cli.mjs`](https://github.com/gntik-ai/falcone/blob/main/apps/control-plane/webhook-key-credential-cli.mjs)
  and [`webhook-key-lifecycle-cli.mjs`](https://github.com/gntik-ai/falcone/blob/main/apps/control-plane/webhook-key-lifecycle-cli.mjs);
- startup gate: [`webhook-key-runtime.mjs`](https://github.com/gntik-ai/falcone/blob/main/apps/control-plane/webhook-key-runtime.mjs)
  and [`control-plane-startup.mjs`](https://github.com/gntik-ai/falcone/blob/main/apps/control-plane/control-plane-startup.mjs);
- parser/state/transaction behavior: [`webhook-master-key.mjs`](https://github.com/gntik-ai/falcone/blob/main/packages/webhook-engine/src/webhook-master-key.mjs)
  and [`webhook-master-key-lifecycle.mjs`](https://github.com/gntik-ai/falcone/blob/main/packages/webhook-engine/src/webhook-master-key-lifecycle.mjs);
- persistence: [`004-webhook-master-key-lifecycle.sql`](https://github.com/gntik-ai/falcone/blob/main/packages/webhook-engine/migrations/004-webhook-master-key-lifecycle.sql);
- normative change: [`fix-audit-c25-webhook-signing-key-lifecycle`](https://github.com/gntik-ai/falcone/tree/main/openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle).

Related documentation:

- [Helm Configuration](/operations/helm-configuration)
- [Secret Management](/operations/secret-management)
- [Backup & Restore](/operations/backup-restore)
- [Observability](/operations/observability)
- [Kubernetes Install](/operations/kubernetes-install)
- [OpenShift Install](/operations/openshift-install)
