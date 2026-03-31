import { BooleanCapability } from '../models/boolean-capability.mjs';

function mapCapability(row) {
  return row ? new BooleanCapability({
    capabilityKey: row.capability_key,
    displayLabel: row.display_label,
    description: row.description,
    platformDefault: Boolean(row.platform_default),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0)
  }) : null;
}

export async function listActiveCatalog(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT capability_key, display_label, description, platform_default, is_active, sort_order
       FROM boolean_capability_catalog
      WHERE is_active = true
      ORDER BY sort_order ASC, capability_key ASC`
  );
  return rows.map(mapCapability);
}

export async function listAllCatalog(pgClient, { includeInactive = false } = {}) {
  const { rows } = includeInactive
    ? await pgClient.query(
      `SELECT capability_key, display_label, description, platform_default, is_active, sort_order
         FROM boolean_capability_catalog
        ORDER BY sort_order ASC, capability_key ASC`
    )
    : await pgClient.query(
      `SELECT capability_key, display_label, description, platform_default, is_active, sort_order
         FROM boolean_capability_catalog
        WHERE is_active = true
        ORDER BY sort_order ASC, capability_key ASC`
    );
  return rows.map(mapCapability);
}

export async function getByKey(pgClient, capabilityKey) {
  const { rows } = await pgClient.query(
    `SELECT capability_key, display_label, description, platform_default, is_active, sort_order
       FROM boolean_capability_catalog
      WHERE capability_key = $1`,
    [capabilityKey]
  );
  return mapCapability(rows[0]);
}

export async function capabilityKeyExists(pgClient, capabilityKey) {
  const capability = await getByKey(pgClient, capabilityKey);
  return Boolean(capability?.isActive);
}

export async function validateCapabilityKeys(pgClient, capabilityKeys) {
  const requested = [...new Set(Array.from(capabilityKeys ?? []).filter(Boolean))];
  if (requested.length === 0) return { valid: true };
  const catalog = await listActiveCatalog(pgClient);
  const activeKeys = new Set(catalog.map((entry) => entry.capabilityKey));
  const invalidKeys = requested.filter((capabilityKey) => !activeKeys.has(capabilityKey));
  if (invalidKeys.length > 0) throw Object.assign(new Error('Invalid capability key'), { code: 'INVALID_CAPABILITY_KEY', invalidKeys });
  return { valid: true };
}
