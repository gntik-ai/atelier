# Backup & Restore

In Falcone's backup system covers configuration restoration and provides guidance for user data backup.

## What Gets Restored Automatically

The provisioning orchestrator can **export and restore configuration** across all subsystems:

### Keycloak (Identity)

| Component | Restored | Notes |
|-----------|----------|-------|
| Realms | Yes | Structure and settings |
| Roles | Yes | Platform and realm roles |
| Clients | Yes | OAuth 2.0 client configurations |
| Client scopes | Yes | Scope definitions |
| Identity providers | Yes | Federation config |
| Users | **No** | Requires realm export |
| Sessions | **No** | Ephemeral |

### PostgreSQL

| Component | Restored | Notes |
|-----------|----------|-------|
| Schemas | Yes | Tenant schemas |
| Tables | Yes | DDL structure |
| Indices | Yes | Index definitions |
| Views | Yes | View definitions |
| Extensions | Yes | pg extensions |
| RLS policies | Yes | Security policies |
| Row data | **No** | Requires pg_dump |

### MongoDB

| Component | Restored | Notes |
|-----------|----------|-------|
| Databases | Yes | Per-workspace databases |
| Collections | Yes | Collection definitions |
| Indices | Yes | Index specifications |
| Validators | Yes | Schema validators |
| Documents | **No** | Requires mongodump |

### Kafka

| Component | Restored | Notes |
|-----------|----------|-------|
| Topics | Yes | Topic configurations |
| ACLs | Yes | Access control lists |
| Partitions | Yes | Partition count |
| Messages | **No** | Requires MirrorMaker 2 |

### OpenWhisk

| Component | Restored | Notes |
|-----------|----------|-------|
| Actions | Yes | Function definitions |
| Packages | Yes | Package organization |
| Triggers | Yes | Event triggers |
| Rules | Yes | Trigger-action bindings |

### S3 (MinIO)

| Component | Restored | Notes |
|-----------|----------|-------|
| Bucket config | Yes | Bucket settings |
| Lifecycle rules | Yes | Retention policies |
| CORS | Yes | CORS configuration |
| Objects | **No** | Requires rclone |

## Configuration Export/Import

### Export

```bash
curl -X POST "http://localhost:9080/v1/platform/config/export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-Correlation-Id: export-$(date +%s)" \
  -d '{
    "scope": "full",
    "format": "json"
  }' -o config-export.json
```

### Validate Before Import

```bash
curl -X POST "http://localhost:9080/v1/platform/config/preflight" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -d @config-export.json | jq .
```

### Import (Reprovision)

```bash
curl -X POST "http://localhost:9080/v1/platform/config/reprovision" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: reprovision-$(date +%s)" \
  -d @config-export.json | jq .
```

## User Data Backup

For user data (not handled by configuration restore), use native tools:

### PostgreSQL

```bash
# Full backup
pg_dump -h <host> -U postgres -d falcone -F c -f backup.dump

# Per-schema backup
pg_dump -h <host> -U postgres -d falcone -n "tenant_acme" -F c -f acme-backup.dump

# Restore
pg_restore -h <host> -U postgres -d falcone backup.dump
```

### MongoDB

```bash
# Full backup
mongodump --host <host> --username root --password <pwd> --out backup/

# Per-database backup
mongodump --host <host> --db wks_01HXXX --out backup/

# Restore
mongorestore --host <host> --username root --password <pwd> backup/
```

### Kafka

Use MirrorMaker 2 for topic replication:

```bash
# mirror-maker-2.properties
clusters = source, target
source.bootstrap.servers = source-kafka:9092
target.bootstrap.servers = target-kafka:9092
source->target.enabled = true
source->target.topics = console\..*
```

### S3 / MinIO

```bash
# Using rclone
rclone sync minio:platform-audit backup/audit/
rclone sync minio:platform-artifacts backup/artifacts/

# Using mc (MinIO Client)
mc mirror minio/platform-audit backup/audit/
```

## Restore Procedure

Recommended order for a full restore:

1. **Preflight** — Validate configuration compatibility
2. **Reprovision** — Restore configuration via the control plane API
3. **Secrets** — Manually restore Vault secrets (redacted in exports)
4. **Data** — Restore user data per subsystem (pg_restore, mongorestore, etc.)
5. **Verify** — Check consistency across subsystems
6. **Test** — Run functional validation

::: danger Important Notes
- Secrets are **redacted** (`***REDACTED***`) in configuration exports for security
- There is **no atomic cross-domain rollback** — restore each subsystem independently
- Dynamic/emergent configuration (runtime state) is not captured in exports
- Always test the restore procedure in a non-production environment first
:::

## Backup Status Service

The backup-status service monitors backup operations:

```bash
# Check backup status
curl "http://localhost:9080/v1/platform/backup/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

### MFA for Restore

Production restore operations require MFA confirmation:

```bash
# Initiate restore with MFA
curl -X POST "http://localhost:9080/v1/platform/backup/restore" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-MFA-Token: <totp-code>" \
  -d @restore-request.json
```

### Operational Hours

Restore operations are restricted to configured operational hours (default: 09:00–18:00) unless explicitly overridden with break-glass authorization.
