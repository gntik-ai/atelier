import { normalizeEffectiveValue } from '../models/effective-entitlement-snapshot.mjs';
import { CapabilityEntry, EffectiveEntitlementProfile, QuantitativeLimitEntry, WorkspaceLimitEntry, isInconsistentSubQuota, resolveSource } from '../models/effective-entitlements.mjs';
import { resolveDimensionCounts } from './consumption-repository.mjs';

export function toCapabilityList(planCapabilities = {}, catalogRows = []) {
  return catalogRows.map((row) => ({
    capabilityKey: row.capability_key,
    displayLabel: row.display_label,
    effectiveState: Object.prototype.hasOwnProperty.call(planCapabilities, row.capability_key)
      ? Boolean(planCapabilities[row.capability_key])
      : Boolean(row.platform_default),
    source: Object.prototype.hasOwnProperty.call(planCapabilities, row.capability_key) ? 'plan' : 'catalog_default'
  })).sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));
}

function toLegacyCapabilityList(capabilities = {}) {
  return Object.entries(capabilities)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capabilityKey, enabled]) => ({ capabilityKey, displayLabel: capabilityKey, effectiveState: Boolean(enabled), source: 'plan' }));
}

function normalizeCapsForLegacyResponse(capabilities = []) {
  return capabilities.map(({ capabilityKey, displayLabel, effectiveState }) => ({ capabilityKey, displayLabel, enabled: effectiveState }));
}

function ensureStore(db) {
  db.catalogDimensions ??= [];
  db.plans ??= new Map();
  db.assignments ??= new Map();
  db.booleanCatalog ??= [];
  db._quotaOverrides ??= [];
  db._workspaceSubQuotas ??= [];
  return db;
}

function getCurrentPlanForTenant(db, tenantId) {
  const assignment = db.assignments.get(tenantId) ?? null;
  return assignment ? db.plans.get(assignment.plan_id ?? assignment.planId) ?? null : null;
}

function buildQuantitativeRowsFromStore(db, tenantId) {
  const plan = getCurrentPlanForTenant(db, tenantId);
  const activeOverrides = new Map(db._quotaOverrides.filter((item) => item.tenantId === tenantId && item.status === 'active').map((item) => [item.dimensionKey, item]));
  return db.catalogDimensions.map((row, index) => {
    const override = activeOverrides.get(row.dimension_key ?? row.dimensionKey);
    const dimensionKey = row.dimension_key ?? row.dimensionKey;
    const planHasDimension = Boolean(plan && Object.prototype.hasOwnProperty.call(plan.quota_dimensions ?? plan.quotaDimensions ?? {}, dimensionKey));
    const planDimensions = plan?.quota_dimensions ?? plan?.quotaDimensions ?? {};
    const planTypeConfig = plan?.quota_type_config ?? plan?.quotaTypeConfig ?? {};
    const quotaTypeEntry = planTypeConfig[dimensionKey] ?? null;
    const effectiveValue = override
      ? Number(override.overrideValue ?? override.override_value)
      : (planHasDimension ? Number(planDimensions[dimensionKey]) : Number(row.default_value ?? row.defaultValue));
    return {
      dimensionKey,
      displayLabel: row.display_label ?? row.displayLabel,
      unit: row.unit,
      effectiveValue,
      source: resolveSource(Boolean(override), planHasDimension),
      quotaType: override?.quotaType ?? override?.quota_type ?? quotaTypeEntry?.type ?? 'hard',
      graceMargin: Number(override?.graceMargin ?? override?.grace_margin ?? quotaTypeEntry?.graceMargin ?? 0),
      sortOrder: Number(row.sort_order ?? index)
    };
  });
}

export async function resolveUnifiedEntitlements({ tenantId }, pgClient) {
  if (pgClient.catalogDimensions !== undefined || pgClient.plans !== undefined) {
    const db = ensureStore(pgClient);
    const plan = getCurrentPlanForTenant(db, tenantId);
    const quantitativeLimits = buildQuantitativeRowsFromStore(db, tenantId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.dimensionKey.localeCompare(b.dimensionKey))
      .map((row) => new QuantitativeLimitEntry(row));
    const caps = db.booleanCatalog.length > 0
      ? toCapabilityList(plan?.capabilities ?? {}, db.booleanCatalog.map((row, index) => ({ ...row, sort_order: row.sort_order ?? index })))
      : toLegacyCapabilityList(plan?.capabilities ?? {});
    return new EffectiveEntitlementProfile({ tenantId, planSlug: plan?.slug ?? null, planStatus: plan?.status ?? null, quantitativeLimits, capabilities: caps.map((entry) => new CapabilityEntry(entry)) });
  }

  let boolCatalogResult = { rows: [] };
  const [quantitativeResult, capabilityPlanResult] = await Promise.all([
    pgClient.query(
      `SELECT c.dimension_key, c.display_label, c.unit,
              COALESCE(o.override_value, (p.quota_dimensions->>c.dimension_key)::bigint, c.default_value) AS effective_value,
              CASE WHEN o.id IS NOT NULL THEN 'override' WHEN p.quota_dimensions ? c.dimension_key THEN 'plan' ELSE 'catalog_default' END AS source,
              COALESCE(o.quota_type, (p.quota_type_config->c.dimension_key->>'type'), 'hard') AS quota_type,
              COALESCE(o.grace_margin, ((p.quota_type_config->c.dimension_key->>'graceMargin')::int), 0) AS grace_margin,
              p.slug AS plan_slug,
              p.status AS plan_status,
              c.id AS sort_order
         FROM quota_dimension_catalog c
         LEFT JOIN tenant_plan_assignments tpa ON tpa.tenant_id = $1 AND tpa.superseded_at IS NULL
         LEFT JOIN plans p ON p.id = tpa.plan_id
         LEFT JOIN quota_overrides o ON o.tenant_id = $1 AND o.dimension_key = c.dimension_key AND o.status = 'active' AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY c.dimension_key ASC`,
      [tenantId]
    ),
    pgClient.query(
      `SELECT p.slug, p.status, p.capabilities
         FROM tenant_plan_assignments tpa
         JOIN plans p ON p.id = tpa.plan_id
        WHERE tpa.tenant_id = $1 AND tpa.superseded_at IS NULL
        LIMIT 1`,
      [tenantId]
    )
  ]);
  try {
    boolCatalogResult = await pgClient.query('SELECT capability_key, display_label, platform_default FROM boolean_capability_catalog WHERE is_active = true ORDER BY sort_order ASC, capability_key ASC');
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  const plan = capabilityPlanResult.rows[0] ?? null;
  const capabilities = boolCatalogResult.rows.length > 0 ? toCapabilityList(plan?.capabilities ?? {}, boolCatalogResult.rows) : toLegacyCapabilityList(plan?.capabilities ?? {});
  return new EffectiveEntitlementProfile({
    tenantId,
    planSlug: quantitativeResult.rows[0]?.plan_slug ?? plan?.slug ?? null,
    planStatus: quantitativeResult.rows[0]?.plan_status ?? plan?.status ?? null,
    quantitativeLimits: quantitativeResult.rows.map((row) => new QuantitativeLimitEntry({ dimensionKey: row.dimension_key, displayLabel: row.display_label, unit: row.unit, effectiveValue: Number(row.effective_value), source: row.source, quotaType: row.quota_type, graceMargin: Number(row.grace_margin ?? 0) })),
    capabilities: capabilities.map((entry) => new CapabilityEntry(entry))
  });
}

export async function resolveWorkspaceLimits({ tenantId, workspaceId }, pgClient) {
  const profile = await resolveUnifiedEntitlements({ tenantId }, pgClient);
  const storeItems = pgClient._workspaceSubQuotas ?? null;
  if (storeItems) {
    const byDimension = new Map(storeItems.filter((item) => item.tenantId === tenantId && item.workspaceId === workspaceId).map((item) => [item.dimensionKey, item]));
    return profile.quantitativeLimits.map((entry) => {
      const subQuota = byDimension.get(entry.dimensionKey);
      return new WorkspaceLimitEntry({ dimensionKey: entry.dimensionKey, tenantEffectiveValue: entry.effectiveValue, tenantSource: entry.source, workspaceLimit: subQuota ? Number(subQuota.allocatedValue) : null, workspaceSource: subQuota ? 'workspace_sub_quota' : 'tenant_shared_pool', isInconsistent: isInconsistentSubQuota(subQuota ? Number(subQuota.allocatedValue) : null, entry.effectiveValue) });
    });
  }
  const { rows } = await pgClient.query(
    `SELECT c.dimension_key,
            COALESCE(o.override_value, (p.quota_dimensions->>c.dimension_key)::bigint, c.default_value) AS tenant_effective_value,
            CASE WHEN o.id IS NOT NULL THEN 'override' WHEN p.quota_dimensions ? c.dimension_key THEN 'plan' ELSE 'catalog_default' END AS tenant_source,
            wsq.allocated_value AS workspace_limit
       FROM quota_dimension_catalog c
       LEFT JOIN tenant_plan_assignments tpa ON tpa.tenant_id = $1 AND tpa.superseded_at IS NULL
       LEFT JOIN plans p ON p.id = tpa.plan_id
       LEFT JOIN quota_overrides o ON o.tenant_id = $1 AND o.dimension_key = c.dimension_key AND o.status = 'active' AND (o.expires_at IS NULL OR o.expires_at > NOW())
       LEFT JOIN workspace_sub_quotas wsq ON wsq.tenant_id = $1 AND wsq.workspace_id = $2 AND wsq.dimension_key = c.dimension_key
      ORDER BY c.dimension_key ASC`,
    [tenantId, workspaceId]
  );
  return rows.map((row) => new WorkspaceLimitEntry({ dimensionKey: row.dimension_key, tenantEffectiveValue: Number(row.tenant_effective_value), tenantSource: row.tenant_source, workspaceLimit: row.workspace_limit === null || row.workspace_limit === undefined ? null : Number(row.workspace_limit), workspaceSource: row.workspace_limit === null || row.workspace_limit === undefined ? 'tenant_shared_pool' : 'workspace_sub_quota', isInconsistent: isInconsistentSubQuota(row.workspace_limit === null || row.workspace_limit === undefined ? null : Number(row.workspace_limit), Number(row.tenant_effective_value)) }));
}

export async function resolveTenantConsumption(pgClient, tenantId) {
  const profile = await resolveUnifiedEntitlements({ tenantId }, pgClient);
  const counts = await resolveDimensionCounts(pgClient, tenantId, profile.quantitativeLimits.map((entry) => ({ dimensionKey: entry.dimensionKey, effectiveValue: entry.effectiveValue })));
  return new EffectiveEntitlementProfile({
    tenantId: profile.tenantId,
    planSlug: profile.planSlug,
    planStatus: profile.planStatus,
    quantitativeLimits: profile.quantitativeLimits.map((entry) => new QuantitativeLimitEntry({
      dimensionKey: entry.dimensionKey,
      displayLabel: entry.displayLabel,
      unit: entry.unit,
      effectiveValue: entry.effectiveValue,
      source: entry.source,
      quotaType: entry.quotaType,
      graceMargin: entry.graceMargin,
      currentUsage: counts.get(entry.dimensionKey)?.currentUsage ?? null,
      usageStatus: counts.get(entry.dimensionKey)?.usageStatus ?? 'unknown',
      usageUnknownReason: counts.get(entry.dimensionKey)?.usageUnknownReason ?? null
    })),
    capabilities: profile.capabilities
  });
}

export async function resolveWorkspaceConsumption(pgClient, tenantId, workspaceId) {
  const [workspaceLimits, profile] = await Promise.all([
    resolveWorkspaceLimits({ tenantId, workspaceId }, pgClient),
    resolveUnifiedEntitlements({ tenantId }, pgClient)
  ]);
  const dimensionMeta = new Map(profile.quantitativeLimits.map((entry) => [entry.dimensionKey, entry]));
  const counts = await resolveDimensionCounts(pgClient, tenantId, workspaceLimits.map((entry) => ({ dimensionKey: entry.dimensionKey, effectiveValue: entry.workspaceLimit ?? entry.tenantEffectiveValue })), workspaceId);
  return {
    tenantId,
    workspaceId,
    quantitativeLimits: workspaceLimits.map((entry) => ({
      dimensionKey: entry.dimensionKey,
      displayLabel: dimensionMeta.get(entry.dimensionKey)?.displayLabel ?? entry.dimensionKey,
      unit: dimensionMeta.get(entry.dimensionKey)?.unit ?? null,
      tenantEffectiveValue: entry.tenantEffectiveValue,
      workspaceLimit: entry.workspaceLimit,
      workspaceSource: entry.workspaceSource,
      currentUsage: counts.get(entry.dimensionKey)?.currentUsage ?? null,
      usageStatus: counts.get(entry.dimensionKey)?.usageStatus ?? 'unknown',
      usageUnknownReason: counts.get(entry.dimensionKey)?.usageUnknownReason ?? null
    })),
    capabilities: profile.capabilities
  };
}

export async function resolveEffectiveEntitlements(client, tenantId, planId) {
  let boolCatalogResult = { rows: [] };
  const [catalogResult, planResult] = await Promise.all([
    client.query('SELECT dimension_key, display_label, unit, default_value FROM quota_dimension_catalog ORDER BY dimension_key ASC'),
    client.query('SELECT id, slug, display_name, quota_dimensions, capabilities FROM plans WHERE id = $1', [planId])
  ]);
  try {
    boolCatalogResult = await client.query('SELECT capability_key, display_label, platform_default FROM boolean_capability_catalog WHERE is_active = true ORDER BY sort_order ASC, capability_key ASC');
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  const plan = planResult.rows[0] ?? null;
  if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
  let overrides = {};
  try {
    const overrideResult = await client.query('SELECT quota_overrides, capability_overrides FROM tenant_plan_adjustments WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    overrides = overrideResult.rows[0] ?? {};
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  const planQuotaDimensions = plan.quota_dimensions ?? {};
  const quotaOverrides = overrides.quota_overrides ?? {};
  const capabilityOverrides = overrides.capability_overrides ?? {};
  const quotaDimensions = catalogResult.rows.map((row) => {
    const candidate = Object.prototype.hasOwnProperty.call(quotaOverrides, row.dimension_key)
      ? quotaOverrides[row.dimension_key]
      : (Object.prototype.hasOwnProperty.call(planQuotaDimensions, row.dimension_key) ? planQuotaDimensions[row.dimension_key] : row.default_value);
    const normalized = normalizeEffectiveValue(candidate);
    return { dimensionKey: row.dimension_key, displayLabel: row.display_label, unit: row.unit, effectiveValueKind: normalized.effectiveValueKind, effectiveValue: normalized.effectiveValue };
  });
  const mergedCapabilities = { ...(plan.capabilities ?? {}), ...capabilityOverrides };
  const capabilities = boolCatalogResult.rows.length > 0 ? toCapabilityList(mergedCapabilities, boolCatalogResult.rows) : toLegacyCapabilityList(mergedCapabilities);
  return { tenantId, planId: plan.id, planSlug: plan.slug, planDisplayName: plan.display_name, quotaDimensions, capabilities: normalizeCapsForLegacyResponse(capabilities) };
}
