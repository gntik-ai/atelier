# Backup & Restore

Falcone has two backup layers:

- **Tenant-level artifacts** for tenant resources and restore workflows.
- **Platform backup evidence** for Helm state, Kubernetes Secrets, External Secrets/OpenBao state,
  and rollback support during platform migrations.

Use both layers for disaster recovery. Tenant artifacts are not a replacement for infrastructure
backups of PostgreSQL, DocumentDB, Kafka, SeaweedFS, OpenBao, and PersistentVolumes.

## Tenant-level restore

## Per-tenant artifact

A tenant backup is a multi-domain artifact. A restore can target all or a **subset** of domains:

| Domain | Contents |
| --- | --- |
| `iam` | Members, roles, service accounts |
| `postgres_metadata` | Relational schema/metadata |
| `mongo_metadata` | Document collections metadata |
| `kafka` | Topics / event config |
| `storage` | Object storage layout |

## Restore flows (verified by the suite)

- **Full restore on an empty tenant** — the golden path (`E1`).
- **Partial restore** — restore only selected domains, e.g. `iam + postgres_metadata`, or `kafka + storage` (`E2`).
- **Restore with conflicts** — e.g. an IAM role-name collision is detected and handled rather than silently overwriting (`E3`).
- **Degraded artifact** — a domain marked `not_available` (e.g. `mongo_metadata`) is handled without failing the whole restore (`E4`).
- **Format migration** — older artifact formats are migrated on restore (`E5`).

## Safety guarantees

The suite pins several operational invariants:

- **Tenant-ID mismatch** — restoring into a different tenant runs a **preflight** that proposes an identifier map; the restore only proceeds with that mapping, so resources are never silently grafted onto the wrong tenant (`EC2`).
- **Concurrent restore is blocked** — a second concurrent restore for the same tenant gets **`409 Conflict`** (`EC3`).
- **Partial failure & retry** — if one domain fails (e.g. Kafka), the operation can be retried to completion (`EC1`).
- **Max-size artifact** — large artifacts are handled without truncation or timeout (`EC4`).
- **Suspended tenant** — reprovision/restore on a suspended tenant is rejected or explicitly skipped (`EC5`).

## Running the restore workflow

```bash
npm run test:e2e:restore
```

This drives the restore behaviour against the workflow harness and can write a suite manifest report.

## Platform backup and rollback evidence

The all-core platform migration scripts under
`scripts/system-changes/make-all-services-core/` provide the current repo-grounded platform backup
and rollback workflow:

| Script | Purpose |
| --- | --- |
| `backup-kv.sh` | Create a backup archive for platform KV/Secrets and migration evidence. |
| `parity-check.sh` | Check source/target parity without mutating the install when run with `--dry-run`. |
| `migrate-platform-secrets.sh` | Migrate platform secrets with `--dry-run` or `--apply`. |
| `diff-rollout.sh` | Render/diff a rollout against a chart path. |
| `restore-kv.sh` | Restore from a backup archive, with `--dry-run`, `--apply`, and optional Helm rollback support. |

Create a platform backup archive:

```bash
scripts/system-changes/make-all-services-core/backup-kv.sh \
  --output /secure/path/falcone-kv-backup.tgz
```

Run a parity check before changing the platform:

```bash
scripts/system-changes/make-all-services-core/parity-check.sh --dry-run
```

Dry-run a restore:

```bash
scripts/system-changes/make-all-services-core/restore-kv.sh \
  --backup /secure/path/falcone-kv-backup.tgz \
  --dry-run
```

Apply a restore only after reviewing the dry-run output:

```bash
scripts/system-changes/make-all-services-core/restore-kv.sh \
  --backup /secure/path/falcone-kv-backup.tgz \
  --apply
```

When a Helm rollback is required, include the rollback flag and, if needed, a revision:

```bash
scripts/system-changes/make-all-services-core/restore-kv.sh \
  --backup /secure/path/falcone-kv-backup.tgz \
  --apply \
  --helm-rollback \
  --revision <helm-revision>
```

> [!DANGER]
> Do not use this Helm-rollback option across a webhook signing master-key adoption, rotation,
> recovery, or finalization. A historical revision may expose the old literal key and can point the
> application at a key that does not decrypt the restored database. Use the fixed chart's forward
> replay/recovery procedure in the
> [Webhook Signing Master-Key Lifecycle Runbook](/operations/webhook-signing-key-lifecycle).

## Recommended practice

- Schedule per-tenant backups so each tenant can be restored independently — this is what keeps restore from being an all-or-nothing platform operation.
- Always restore through the preflight when the target tenant differs from the source, so identifiers are remapped rather than colliding.
- Treat the underlying backends (PostgreSQL, the FerretDB + DocumentDB document store, object storage, Kafka) with your standard infrastructure backup tooling in addition to the tenant-level artifact, for full disaster recovery. The document store's durable state lives in the DocumentDB engine's PostgreSQL volume, so back it up as a Postgres instance.
- Back up Helm values, rendered manifests, Kubernetes Secrets, ExternalSecret resources, OpenBao KV
  state, and PersistentVolumes before chart upgrades or migration scripts.
- Do not paste real credentials into issue comments, docs, or terminal transcripts. Use placeholders
  when sharing evidence.
- Couple every backup containing `webhook_signing_secrets` with the matching current/recovery Secret
  identity and protected custody version. The generic KV archive is secret-bearing recovery custody,
  not audit evidence, and does not replace the PostgreSQL backup.
