# Data Model: Backup Scope & Limits by Deployment Profile

**Branch**: `114-backup-scope-deployment-profiles` | **Date**: 2026-04-01

## DDL

### `deployment_profile_registry`

```sql
CREATE TABLE IF NOT EXISTS deployment_profile_registry (
  profile_key   TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed: `all-in-one`, `standard` (active), `ha`, `unknown` (inactive).

### `backup_scope_entries`

```sql
CREATE TABLE IF NOT EXISTS backup_scope_entries (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_key                 TEXT NOT NULL,
  profile_key                   TEXT NOT NULL REFERENCES deployment_profile_registry(profile_key),
  coverage_status               TEXT NOT NULL CHECK (coverage_status IN ('platform-managed','operator-managed','not-supported','unknown')),
  backup_granularity            TEXT NOT NULL CHECK (backup_granularity IN ('full','incremental','config-only','none','unknown')),
  rpo_range_minutes             INT4RANGE,
  rto_range_minutes             INT4RANGE,
  max_backup_frequency_minutes  INT,
  max_retention_days            INT,
  max_concurrent_jobs           INT,
  max_backup_size_gb            NUMERIC,
  preconditions                 TEXT[],
  limitations                   TEXT[],
  air_gap_notes                 TEXT,
  plan_capability_key           TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (component_key, profile_key)
);

CREATE INDEX IF NOT EXISTS idx_backup_scope_profile ON backup_scope_entries(profile_key);
CREATE INDEX IF NOT EXISTS idx_backup_scope_component ON backup_scope_entries(component_key);
```

### Triggers

Both tables use the existing `set_updated_at_timestamp()` function.

### `boolean_capability_catalog` extension

```sql
INSERT INTO boolean_capability_catalog (capability_key, display_label, description, platform_default, is_active, sort_order)
VALUES ('backup_scope_access', 'Backup Scope Access', 'Enables visibility into backup scope and limits for the tenant', false, true, 80)
ON CONFLICT (capability_key) DO NOTHING;
```

---

## API Response Shapes

### `GET /v1/admin/backup/scope` → `BackupScopeMatrixResponse`

```json
{
  "activeProfile": "standard",
  "requestedProfile": "standard",
  "entries": [BackupScopeEntry],
  "generatedAt": "2026-04-01T10:00:00.000Z",
  "correlationId": "req-abc123"
}
```

#### `BackupScopeEntry`

| Field | Type | Description |
|---|---|---|
| `componentKey` | `string` | Component identifier |
| `profileKey` | `string` | Deployment profile key |
| `coverageStatus` | `'platform-managed' \| 'operator-managed' \| 'not-supported' \| 'unknown'` | Backup coverage status |
| `backupGranularity` | `'full' \| 'incremental' \| 'config-only' \| 'none' \| 'unknown'` | Backup granularity |
| `rpoRangeMinutes` | `{ min: number, max: number } \| null` | RPO range in minutes |
| `rtoRangeMinutes` | `{ min: number, max: number } \| null` | RTO range in minutes |
| `operationalStatus` | `'operational' \| 'degraded' \| 'unknown'` | Current operational status (from health join) |
| `supportedByProfile` | `boolean` | Whether backup is supported for this component on this profile |
| `maxBackupFrequencyMinutes` | `number \| null` | Minimum interval between backups |
| `maxRetentionDays` | `number \| null` | Maximum backup retention |
| `maxConcurrentJobs` | `number \| null` | Maximum concurrent backup jobs |
| `maxBackupSizeGb` | `number \| null` | Maximum backup size in GB |
| `preconditions` | `string[]` | Precondition notes |
| `limitations` | `string[]` | Limitation notes |
| `airGapNotes` | `string \| null` | Air-gap specific notes |
| `planCapabilityKey` | `string \| null` | Required plan capability |

### `GET /v1/tenants/{tenantId}/backup/scope` → `TenantBackupScopeResponse`

```json
{
  "tenantId": "ten-xyz",
  "activeProfile": "standard",
  "planId": "plan-pro",
  "entries": [TenantBackupScopeEntry],
  "generatedAt": "2026-04-01T10:00:00.000Z",
  "correlationId": "req-def456"
}
```

#### `TenantBackupScopeEntry`

| Field | Type | Description |
|---|---|---|
| `componentKey` | `string` | Component identifier |
| `coverageStatus` | `string` | Backup coverage status |
| `backupGranularity` | `string` | Backup granularity |
| `rpoRangeMinutes` | `{ min: number, max: number } \| null` | RPO range |
| `rtoRangeMinutes` | `{ min: number, max: number } \| null` | RTO range |
| `operationalStatus` | `string` | Operational status |
| `tenantHasResources` | `boolean` | Tenant actually uses this component |
| `planRestriction` | `string \| null` | Plan-level restriction note |
| `recommendation` | `string \| null` | Recommendation for non-supported or operator-managed |

---

## Component Prop Types (Console)

```typescript
export interface BackupScopeEntry {
  componentKey: string;
  profileKey: string;
  coverageStatus: 'platform-managed' | 'operator-managed' | 'not-supported' | 'unknown';
  backupGranularity: 'full' | 'incremental' | 'config-only' | 'none' | 'unknown';
  rpoRangeMinutes: { min: number; max: number } | null;
  rtoRangeMinutes: { min: number; max: number } | null;
  operationalStatus: 'operational' | 'degraded' | 'unknown';
  supportedByProfile: boolean;
  maxBackupFrequencyMinutes: number | null;
  maxRetentionDays: number | null;
  maxConcurrentJobs: number | null;
  maxBackupSizeGb: number | null;
  preconditions: string[];
  limitations: string[];
  airGapNotes: string | null;
  planCapabilityKey: string | null;
}

export interface BackupScopeMatrixResponse {
  activeProfile: string;
  requestedProfile: string;
  entries: BackupScopeEntry[];
  generatedAt: string;
  correlationId: string;
}

export interface TenantBackupScopeEntry {
  componentKey: string;
  coverageStatus: string;
  backupGranularity: string;
  rpoRangeMinutes: { min: number; max: number } | null;
  rtoRangeMinutes: { min: number; max: number } | null;
  operationalStatus: string;
  tenantHasResources: boolean;
  planRestriction: string | null;
  recommendation: string | null;
}

export interface TenantBackupScopeResponse {
  tenantId: string;
  activeProfile: string;
  planId: string;
  entries: TenantBackupScopeEntry[];
  generatedAt: string;
  correlationId: string;
}
```

---

## Health Join Strategy

When `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=true` **and** the `component_health_status` table exists:

```sql
LEFT JOIN component_health_status chs ON chs.component_key = bse.component_key
```

`operationalStatus` resolves to `COALESCE(chs.status, 'unknown')`.

When disabled or table absent: `operationalStatus` = `'unknown'` for all rows. No error raised.
