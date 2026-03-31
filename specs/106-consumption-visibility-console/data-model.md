# Data Model: Consumption Visibility Console (106)

## No New Database Tables

T04 is a read-only feature. All persistent storage was introduced in T01–T03. T04 queries the following existing tables:

| Table | Introduced In | T04 Query Pattern |
|-------|---------------|-------------------|
| `quota_dimension_catalog` | T01 (103) | SELECT all active dimensions |
| `plans` | T01 (097) | SELECT name, slug, status, description by plan_id |
| `tenant_plan_assignments` | T01 (097) | SELECT current assignment by tenant_id |
| `quota_overrides` | T01 (103) | SELECT active overrides by tenant_id + dimension_key |
| `boolean_capability_catalog` | T02 (104) | SELECT all capability labels |
| `workspace_sub_quotas` | T03 (105) | SELECT by tenant_id (allocation summary) or tenant_id + workspace_id (workspace consumption) |
| `workspaces` | Pre-existing | COUNT by tenant_id (+ workspace_id for workspace scope) |
| `pg_databases` | Pre-existing | COUNT by tenant_id (+ workspace_id) |
| `functions` | Pre-existing | COUNT by tenant_id (+ workspace_id) |
| `kafka_topics` | Pre-existing | COUNT by tenant_id (+ workspace_id) |
| `realtime_channels` | Pre-existing | COUNT by tenant_id (+ workspace_id) |
| `storage_objects` | Pre-existing | SUM(size_bytes) / 1e9 by tenant_id |
| `api_call_logs` | Pre-existing | COUNT by tenant_id, current calendar month |
| `workspace_members` | Pre-existing | COUNT by tenant_id (+ workspace_id) |

---

## TypeScript Types (extensions to `planManagementApi.ts`)

### New Type: `ConsumptionSnapshot`

```typescript
export interface DimensionConsumptionRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  currentUsage: number | null        // null when usageStatus === 'unknown'
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
}

export interface ConsumptionSnapshot {
  tenantId: string
  snapshotAt: string                 // ISO-8601
  dimensions: DimensionConsumptionRow[]
}
```

Note: `UsageStatus` already exported from `planManagementApi.ts` as `'within_limit' | 'at_limit' | 'over_limit' | 'unknown'`. T04 adds the `'approaching_limit'` variant (80–99%).

```typescript
// Extended UsageStatus — add to existing type alias
export type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'
```

### New Type: `WorkspaceConsumptionResponse`

```typescript
export interface WorkspaceDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  tenantEffectiveValue: number       // -1 = unlimited
  workspaceLimit: number | null      // null = shared tenant pool
  workspaceSource: 'workspace_sub_quota' | 'tenant_shared_pool'
  currentUsage: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
}

export interface WorkspaceConsumptionResponse {
  tenantId: string
  workspaceId: string
  snapshotAt: string
  dimensions: WorkspaceDimensionRow[]
}
```

### New Type: `AllocationSummaryResponse`

```typescript
export interface AllocationSummaryDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  tenantEffectiveValue: number       // -1 = unlimited
  totalAllocated: number
  unallocated: number | null         // null when tenantEffectiveValue === -1
  isFullyAllocated: boolean
  workspaces: Array<{
    workspaceId: string
    allocatedValue: number
  }>
}

export interface AllocationSummaryResponse {
  tenantId: string
  dimensions: AllocationSummaryDimensionRow[]
}
```

### New API Functions

```typescript
// Tenant owner: own consumption
export function getTenantConsumption(): Promise<ConsumptionSnapshot>
// Superadmin: any tenant consumption
export function getTenantConsumptionByAdmin(tenantId: string): Promise<ConsumptionSnapshot>
// Tenant owner: allocation summary across workspaces
export function getTenantAllocationSummary(): Promise<AllocationSummaryResponse>
// Workspace admin: own workspace consumption
export function getWorkspaceConsumption(workspaceId: string): Promise<WorkspaceConsumptionResponse>
// Superadmin: any workspace consumption
export function getWorkspaceConsumptionByAdmin(tenantId: string, workspaceId: string): Promise<WorkspaceConsumptionResponse>
```

---

## Console Component API Contracts

### `ConsumptionBar` (`apps/web-console/src/components/console/ConsumptionBar.tsx`)

```typescript
interface ConsumptionBarProps {
  current: number | null   // null → "data unavailable" indicator
  limit: number            // -1 → unlimited render
  label?: string           // aria-label, default: "quota consumption"
  className?: string
}
```

Rendering rules:
- `limit === -1`: show `{current ?? '—'} / Unlimited`, no `<progress>`, no color
- `current === null`: show muted row with "Data unavailable" text
- `limit === 0`: show `{current} / 0`, red bar at 100%, "Blocked" label
- Otherwise: `pct = (current / limit) * 100`; bar fills to `min(pct, 100)%`; overflow extends beyond bar with red indicator
- Color: `pct < 80` → emerald, `80 ≤ pct < 100` → amber, `pct ≥ 100` → red
- ARIA: `role="progressbar"`, `aria-valuenow={Math.round(pct)}`, `aria-valuemin={0}`, `aria-valuemax={100}`

### `QuotaConsumptionTable` (`apps/web-console/src/components/console/QuotaConsumptionTable.tsx`)

```typescript
interface QuotaDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  effectiveValue: number
  source: 'override' | 'plan' | 'catalog_default'
  quotaType: 'hard' | 'soft'
  currentUsage: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
  overriddenFromValue?: number | null    // superadmin only
  originalPlanValue?: number | null      // superadmin only
}

interface QuotaConsumptionTableProps {
  rows: QuotaDimensionRow[]
  showOverrideDetails?: boolean          // default false
  emptyMessage?: string
}
```

Columns when `showOverrideDetails=false`: Dimension | Limit | Consumption Bar | Source
Columns when `showOverrideDetails=true`: Dimension | Plan Limit | Effective Limit | Consumption Bar | Source | Override

### `CapabilityStatusGrid` (`apps/web-console/src/components/console/CapabilityStatusGrid.tsx`)

```typescript
interface CapabilityRow {
  capabilityKey: string
  displayLabel: string
  enabled: boolean
  source: 'plan' | 'catalog_default'
}

interface CapabilityStatusGridProps {
  capabilities: CapabilityRow[]
  readOnly?: boolean          // default true (workspace view)
}
```

Renders a 2-column (md: 3-column) responsive grid. Each cell: capability label + enabled/disabled badge (`PlanCapabilityBadge` from T02). Source annotation in muted text.

### `OverrideIndicatorBadge` (`apps/web-console/src/components/console/OverrideIndicatorBadge.tsx`)

```typescript
interface OverrideIndicatorBadgeProps {
  overriddenFromValue: number
  overrideValue: number
  dimensionLabel?: string
}
```

Renders an amber badge "Override" with a `title` / tooltip: `"Plan value: {overriddenFromValue} → Override: {overrideValue}"`.

### `WorkspaceAllocationSummaryTable` (`apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx`)

```typescript
interface AllocationSummaryRow {
  dimensionKey: string
  displayLabel: string
  unit: string | null
  tenantEffectiveValue: number       // -1 = unlimited
  totalAllocated: number
  unallocated: number | null
  isFullyAllocated: boolean
  workspaces: { workspaceId: string; allocatedValue: number }[]
}

interface WorkspaceAllocationSummaryTableProps {
  rows: AllocationSummaryRow[]
  emptyMessage?: string
}
```

Columns: Dimension | Total Limit | Allocated | Unallocated | Workspaces (expandable)
When `tenantEffectiveValue === -1`: Total Limit shows "Unlimited"; Unallocated shows "—"; no percentage.

---

## Backend Action Signatures

### `tenant-consumption-snapshot-get.mjs`

```js
// Input: { tenantId: string, actorType: 'tenant_owner' | 'superadmin' }
// Output: ConsumptionSnapshot (see TypeScript type above)
// Auth: tenant_owner may only request own tenantId; superadmin unrestricted
// Error codes: FORBIDDEN (403), TENANT_NOT_FOUND (404)
```

### `workspace-consumption-get.mjs`

```js
// Input: { tenantId: string, workspaceId: string, actorType: 'workspace_admin' | 'tenant_owner' | 'superadmin' }
// Output: WorkspaceConsumptionResponse
// Auth: workspace_admin/tenant_owner: own tenant only; superadmin: unrestricted
// Error codes: FORBIDDEN (403), TENANT_NOT_FOUND (404), WORKSPACE_NOT_FOUND (404)
```

### `tenant-workspace-allocation-summary-get.mjs`

```js
// Input: { tenantId: string, actorType: 'tenant_owner' | 'superadmin' }
// Output: AllocationSummaryResponse
// Auth: tenant_owner may only request own tenantId; superadmin unrestricted
// Error codes: FORBIDDEN (403), TENANT_NOT_FOUND (404)
```

### Extension: `tenant-effective-entitlements-get.mjs` with `?include=consumption`

```js
// Existing action extended: if params.include === 'consumption', call resolveTenantConsumption
// and merge { currentUsage, usageStatus, usageUnknownReason } into each quantitativeLimits item
// No change to existing output shape when include is absent (backwards compatible)
```
