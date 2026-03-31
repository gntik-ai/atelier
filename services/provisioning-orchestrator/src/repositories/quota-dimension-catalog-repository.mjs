import { QuotaDimension } from '../models/quota-dimension.mjs';

function mapDimension(row) {
  return row ? new QuotaDimension({
    dimensionKey: row.dimension_key,
    displayLabel: row.display_label,
    unit: row.unit,
    defaultValue: Number(row.default_value),
    description: row.description ?? null
  }) : null;
}

export async function listAllDimensions(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT dimension_key, display_label, unit, default_value, description
       FROM quota_dimension_catalog
      ORDER BY dimension_key ASC`
  );
  return rows.map(mapDimension);
}

export async function getDimensionByKey(pgClient, dimensionKey) {
  const { rows } = await pgClient.query(
    `SELECT dimension_key, display_label, unit, default_value, description
       FROM quota_dimension_catalog
      WHERE dimension_key = $1`,
    [dimensionKey]
  );
  return mapDimension(rows[0]);
}

export async function dimensionKeyExists(pgClient, dimensionKey) {
  return Boolean(await getDimensionByKey(pgClient, dimensionKey));
}

export async function getDefaultValue(pgClient, dimensionKey) {
  const dimension = await getDimensionByKey(pgClient, dimensionKey);
  return dimension?.defaultValue ?? null;
}
