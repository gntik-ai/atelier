export const SEEDED_DIMENSIONS = [
  { dimensionKey: 'max_workspaces', displayLabel: 'Maximum Workspaces', unit: 'count', defaultValue: 3 },
  { dimensionKey: 'max_pg_databases', displayLabel: 'Maximum PostgreSQL Databases', unit: 'count', defaultValue: 5 },
  { dimensionKey: 'max_mongo_databases', displayLabel: 'Maximum MongoDB Databases', unit: 'count', defaultValue: 2 },
  { dimensionKey: 'max_kafka_topics', displayLabel: 'Maximum Kafka Topics', unit: 'count', defaultValue: 10 },
  { dimensionKey: 'max_functions', displayLabel: 'Maximum Functions', unit: 'count', defaultValue: 50 },
  { dimensionKey: 'max_storage_bytes', displayLabel: 'Maximum Storage', unit: 'bytes', defaultValue: 5368709120 },
  { dimensionKey: 'max_api_keys', displayLabel: 'Maximum API Keys', unit: 'count', defaultValue: 20 },
  { dimensionKey: 'max_workspace_members', displayLabel: 'Maximum Workspace Members', unit: 'count', defaultValue: 10 }
];

export async function ensureCatalogSeeded(pgClient) {
  if (!pgClient?.catalog) pgClient.catalog = new Map();
  for (const dimension of SEEDED_DIMENSIONS) {
    pgClient.catalog.set(dimension.dimensionKey, {
      dimension_key: dimension.dimensionKey,
      display_label: dimension.displayLabel,
      unit: dimension.unit,
      default_value: dimension.defaultValue,
      description: `${dimension.displayLabel} default`
    });
  }
  return SEEDED_DIMENSIONS;
}
