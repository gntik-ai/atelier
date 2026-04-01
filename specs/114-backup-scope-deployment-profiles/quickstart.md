# Quickstart: Backup Scope & Limits by Deployment Profile

## Prerequisites

- PostgreSQL running and accessible
- Node.js 20+
- pnpm installed

## Run the migration

```bash
psql "$DATABASE_URL" -f services/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql
```

## Verify seed data

```sql
SELECT COUNT(*) FROM deployment_profile_registry;
-- Expected: 4 (all-in-one, standard, ha, unknown)

SELECT COUNT(*) FROM backup_scope_entries;
-- Expected: 21 (7 components × 3 profiles)

SELECT profile_key, is_active FROM deployment_profile_registry ORDER BY profile_key;
-- Expected: standard has is_active = true
```

## Switch active profile (manual — until US-DEP-03)

```sql
UPDATE deployment_profile_registry SET is_active = false;
UPDATE deployment_profile_registry SET is_active = true WHERE profile_key = 'ha';
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BACKUP_SCOPE_KAFKA_TOPIC_QUERIED` | `console.backup.scope.queried` | Kafka audit topic name |
| `BACKUP_SCOPE_HEALTH_JOIN_ENABLED` | `false` | Enable health table join for operationalStatus |

## Run integration tests

```bash
node --test tests/integration/114-backup-scope-deployment-profiles/
```

## Run console component tests

```bash
cd apps/web-console
pnpm vitest run src/__tests__/BackupScopeMatrix.test.tsx src/__tests__/ConsoleBackupScopePage.test.tsx
```

## Run all console tests

```bash
cd apps/web-console
pnpm vitest run
```
