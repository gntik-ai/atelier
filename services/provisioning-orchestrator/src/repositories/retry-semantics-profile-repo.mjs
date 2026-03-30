export async function findByOperationType(client, operationType) {
  const result = await client.query(
    'SELECT * FROM retry_semantics_profiles WHERE operation_type = $1 LIMIT 1',
    [operationType]
  );
  return result.rows[0] ?? null;
}

export async function findDefault(client) {
  const result = await client.query(
    "SELECT * FROM retry_semantics_profiles WHERE operation_type = '__default__' OR is_default = TRUE ORDER BY CASE WHEN operation_type = '__default__' THEN 0 ELSE 1 END LIMIT 1"
  );
  return result.rows[0] ?? null;
}

export async function upsert(client, profile) {
  const result = await client.query(
    `INSERT INTO retry_semantics_profiles (
      operation_type, max_retries, backoff_strategy, backoff_base_seconds, intervention_conditions, failure_categories, is_default
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (operation_type) DO UPDATE SET
      max_retries = EXCLUDED.max_retries,
      backoff_strategy = EXCLUDED.backoff_strategy,
      backoff_base_seconds = EXCLUDED.backoff_base_seconds,
      intervention_conditions = EXCLUDED.intervention_conditions,
      failure_categories = EXCLUDED.failure_categories,
      is_default = EXCLUDED.is_default,
      updated_at = NOW()
    RETURNING *`,
    [
      profile.operationType ?? profile.operation_type,
      profile.maxRetries ?? profile.max_retries,
      profile.backoffStrategy ?? profile.backoff_strategy,
      profile.backoffBaseSeconds ?? profile.backoff_base_seconds,
      JSON.stringify(profile.interventionConditions ?? profile.intervention_conditions ?? []),
      JSON.stringify(profile.failureCategories ?? profile.failure_categories ?? {}),
      profile.isDefault ?? profile.is_default ?? false
    ]
  );

  return result.rows[0] ?? null;
}
