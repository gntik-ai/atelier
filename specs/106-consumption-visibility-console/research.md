# Research: Consumption Visibility Console (106)

## R-01 — Consumption Counting via Provisioning Tables

**Decision**: New `consumption-repository.mjs` with a static `DIMENSION_QUERY_MAP` registry that maps each `dimension_key` to a SQL query against the relevant provisioning table (`workspaces`, `pg_databases`, `functions`, `kafka_topics`, `realtime_channels`, `storage_objects`, `api_call_logs`, `workspace_members`).

**Rationale**: No separate metering/OLAP infrastructure exists in scope. Provisioning tables are the authoritative source of record for resource counts at query time. The registry pattern makes it easy to add new dimensions as the catalog grows without touching core resolution logic.

**Alternatives considered**:
1. External metering service (US-OBS-03) — rejected for T04: US-OBS-03 is a separate story with undetermined timeline; spec assumption states "consumption counts are obtainable from existing platform services." T04 uses the simplest available source now; the registry can be extended to call an external metering API per dimension when US-OBS-03 ships.
2. Materialized view or pre-aggregated cache — rejected: Constitution Principle II (premature optimization); COUNT queries at expected scale (≤ 10 workspaces, ≤ 200 tenants) are well within performance targets.
3. JSONB usage snapshot column on `tenant_plan_assignments` — rejected: coupling resource counts to plan assignment data is semantically wrong and would require additional write paths.

---

## R-02 — Extend vs. New Action for Combined Entitlements + Consumption

**Decision**: Extend existing `tenant-effective-entitlements-get` with an optional `?include=consumption` query parameter. A separate `tenant-consumption-snapshot-get` action is also added for clients that want counts-only without entitlement data.

**Rationale**: The console's primary view (`ConsoleTenantPlanOverviewPage`) needs both entitlements and consumption in a single page render — one HTTP call is better than two sequential calls. The existing `CurrentEffectiveEntitlementSummary` shape in `planManagementApi.ts` already carries `observedUsage` and `usageStatus` optional fields specifically anticipating this use. The standalone snapshot action is needed for the superadmin view (which fetches entitlements and consumption separately so it can use different update frequencies in future).

**Alternatives considered**: Always include consumption in entitlements response — rejected: unnecessary latency for callers (e.g., T05 enforcement checks) that need entitlements only.

---

## R-03 — TypeScript API Client: No Shape Changes Needed

**Decision**: `CurrentEffectiveEntitlementSummary` in `planManagementApi.ts` already carries `observedUsage: number | null`, `usageStatus: UsageStatus`, and `usageUnknownReason: string | null` on each `quotaDimensions` item. Three new exported functions are added: `getTenantConsumption`, `getWorkspaceConsumption`, `getTenantAllocationSummary`.

**Rationale**: The forward-designed types mean T04 can use them directly. Adding new functions rather than new types minimizes diff surface and avoids duplicate type definitions.

---

## R-04 — Progress Bar Thresholds

**Decision**: `< 80%` → normal (emerald), `80–99%` → approaching limit (amber), `= 100%` → at limit (red), `> 100%` → over-limit (red + explicit over-limit label). Unlimited (`-1`) → consumption count + "Unlimited" label, no bar.

**Rationale**: 80% approaching threshold is a common SaaS convention (AWS, GCP, Heroku all use 80% as the warning threshold). Matches the semantic color palette already in `ConsoleQuotaPostureBadge` (emerald/amber/red). Spec SC-002 requires visual inspection to identify at-or-above-limit status within 5 seconds — color + progress bar satisfies this without numerical calculation by the user.

**Alternatives considered**: 75% and 90% thresholds — rejected: no spec preference stated; 80% is the industry default.

---

## R-05 — Accessibility for Progress Bars

**Decision**: `ConsumptionBar` renders a `<div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>` structure. Color is complemented by a text percentage display so screen readers and colorblind users can interpret status without relying on color alone.

**Rationale**: FR-005 requires "visual indicators"; WCAG 2.1 AA requires color not be the sole indicator. The `aria-label` prop allows callers to set a meaningful label per dimension.

---

## R-06 — Workspace Consumption Scoping

**Decision**: `resolveWorkspaceConsumption` passes an additional `workspace_id = $workspaceId` filter to each COUNT query in `DIMENSION_QUERY_MAP`. All provisioning tables include a `workspace_id` foreign key.

**Rationale**: Workspace-scoped resource counts are a natural extension of the tenant-scoped counts; the same query pattern applies. If a provisioning table lacks `workspace_id` (e.g., a tenant-level-only resource), the dimension returns `usageStatus: 'unknown'` at workspace level with `usageUnknownReason: 'WORKSPACE_SCOPE_NOT_SUPPORTED'`.

---

## R-07 — Allocation Summary Arithmetic

**Decision**: `tenant-workspace-allocation-summary-get` issues a single query: `SELECT dimension_key, workspace_id, allocated_value FROM workspace_sub_quotas WHERE tenant_id = $t` and computes the grouped sums in the action layer (not SQL `GROUP BY`) to retain per-workspace breakdown in the response.

**Rationale**: The response must include per-workspace detail (US-5, Acceptance SC-1), not just aggregates. Fetching all rows and grouping in JS is safe at expected scale (≤ 10 workspaces × 8 dimensions = ≤ 80 rows per tenant). A separate `GROUP BY` query would require an additional DB round-trip.

---

## R-08 — No Kafka Events / Audit Records in T04

**Decision**: T04 is strictly read-only. No Kafka events emitted. No `plan_audit_events` records. No new env vars.

**Rationale**: All writes with audit implications are in T01–T03. Consumption snapshots are ephemeral query-time views. Constitution Principle II: minimal incremental scope. Alerting on consumption thresholds is explicitly out of scope (spec Scope Boundaries).

---

## R-09 — Graceful Degradation for Missing Dimension Mappings

**Decision**: If a `dimension_key` from `quota_dimension_catalog` has no entry in `DIMENSION_QUERY_MAP`, the consumption result for that dimension is `{ currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'NO_QUERY_MAPPING' }`. This allows new dimensions to be seeded into the catalog before their provisioning tables or query mappings exist, without breaking the consumption view.

**Rationale**: FR-018 explicitly requires rows to remain visible with a "data unavailable" indicator rather than being hidden. The registry approach means adding a new dimension's query mapping is a single-line code change.

---

## R-10 — P2 Pages (Workspace Dashboard + Allocation Summary) Within Scope

**Decision**: Implement `ConsoleWorkspaceDashboardPage` and `ConsoleTenantAllocationSummaryPage` as part of T04 at P2 priority. They depend on the same backend actions (Steps 3–4) and components (Step 6) being built at P1.

**Rationale**: Spec marks US4 and US5 as P2 but they are in scope for T04. Deferring them would create a second console PR later with no backend changes, which is wasteful. Building all pages in one branch is cleaner.
