# Research Spike — US-BKP-01-T06 External Dependencies

**Date**: 2026-04-01 | **Branch**: `114-backup-scope-deployment-profiles`

## 1. US-OBS-01 Component Health Table

**Status**: Not yet available in `main`.

**Decision**: Default `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false`. The `backup-scope-repository.mjs` will include a conditional LEFT JOIN against a future `component_health_status` table when the env var is `true`. When `false` (or table absent), `operationalStatus` resolves to `'unknown'` for all entries without error.

**Fallback schema assumed** (for future join):
```sql
-- Expected from US-OBS-01 (not created by this migration)
-- component_health_status (
--   component_key TEXT PRIMARY KEY,
--   status TEXT CHECK (status IN ('operational', 'degraded', 'unknown')),
--   last_checked_at TIMESTAMPTZ
-- )
```

## 2. US-DEP-03 Deployment Profile Detection

**Status**: Not yet formalized. No Helm values ConfigMap mechanism exists for runtime profile detection.

**Decision**: `deployment_profile_registry.is_active` is set manually via seed data (default: `standard` profile active). A manual SQL command is documented in `quickstart.md` to switch active profile. When US-DEP-03 lands, the bootstrap job will call `UPDATE deployment_profile_registry SET is_active = (profile_key = $1)` at Helm hook time.

## 3. EP-19 `boolean_capability_catalog` — `backup_scope_access`

**Status**: Table exists (migration `104-plan-boolean-capabilities.sql`). The key `backup_scope_access` is **not** present in current seed data.

**Decision**: The `114-backup-scope-deployment-profiles.sql` migration will insert `backup_scope_access` into `boolean_capability_catalog` with `ON CONFLICT DO NOTHING`, making it backward-compatible.

## 4. `platform-admin-routes.yaml` Path

**Status**: File does not exist at `services/gateway-config/routes/platform-admin-routes.yaml`.

**Decision**: Create a new file `services/gateway-config/routes/platform-admin-routes.yaml` following the same YAML structure as existing route files (e.g., `backup-audit-routes.yaml`). The two backup scope routes will be the initial entries.

## Summary of Fallback Flags

| Dependency | Available | Fallback | Env Var |
|---|---|---|---|
| US-OBS-01 health table | No | `operationalStatus` = `'unknown'` | `BACKUP_SCOPE_HEALTH_JOIN_ENABLED` (default `false`) |
| US-DEP-03 profile detection | No | Manual `is_active` update | N/A |
| EP-19 `backup_scope_access` | Partial (table exists, key missing) | Seed in migration | N/A |
| `platform-admin-routes.yaml` | No | Create new file | N/A |
