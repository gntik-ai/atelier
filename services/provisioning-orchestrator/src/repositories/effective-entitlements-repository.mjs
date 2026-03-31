import { normalizeEffectiveValue } from '../models/effective-entitlement-snapshot.mjs';

function toCapabilityList(planCapabilities = {}, catalogRows = []) {
  return catalogRows.map((row) => ({
    capabilityKey: row.capability_key,
    displayLabel: row.display_label,
    enabled: Object.prototype.hasOwnProperty.call(planCapabilities, row.capability_key)
      ? Boolean(planCapabilities[row.capability_key])
      : Boolean(row.platform_default)
  })).sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));
}

function toLegacyCapabilityList(capabilities = {}) {
  return Object.entries(capabilities).sort(([left], [right]) => left.localeCompare(right)).map(([capabilityKey, enabled]) => ({ capabilityKey, displayLabel: capabilityKey, enabled: Boolean(enabled) }));
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
    return {
      dimensionKey: row.dimension_key,
      displayLabel: row.display_label,
      unit: row.unit,
      effectiveValueKind: normalized.effectiveValueKind,
      effectiveValue: normalized.effectiveValue
    };
  });
  const mergedCapabilities = { ...(plan.capabilities ?? {}), ...capabilityOverrides };
  const capabilities = boolCatalogResult.rows.length > 0
    ? toCapabilityList(mergedCapabilities, boolCatalogResult.rows)
    : toLegacyCapabilityList(mergedCapabilities);
  return {
    tenantId,
    planId: plan.id,
    planSlug: plan.slug,
    planDisplayName: plan.display_name,
    quotaDimensions,
    capabilities
  };
}
