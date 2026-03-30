import test from 'node:test';
import assert from 'node:assert/strict';
import { findByOperationType, findDefault, upsert } from '../../services/provisioning-orchestrator/src/repositories/retry-semantics-profile-repo.mjs';

function createClient() {
  const rows = [{ operation_type: '__default__', max_retries: 5, backoff_strategy: 'exponential', backoff_base_seconds: 30, intervention_conditions: [], failure_categories: {}, is_default: true }];
  return {
    async query(sql, params = []) {
      if (sql.includes('WHERE operation_type = $1 LIMIT 1')) return { rows: rows.filter((row) => row.operation_type === params[0]).slice(0, 1) };
      if (sql.includes("WHERE operation_type = '__default__'")) return { rows: rows.filter((row) => row.operation_type === '__default__').slice(0, 1) };
      if (sql.includes('INSERT INTO retry_semantics_profiles')) { const row = { operation_type: params[0], max_retries: params[1], backoff_strategy: params[2], backoff_base_seconds: params[3], intervention_conditions: JSON.parse(params[4]), failure_categories: JSON.parse(params[5]), is_default: params[6] }; rows.push(row); return { rows: [row] }; }
      return { rows: [] };
    }
  };
}

test('profile repo query and upsert flow', async () => {
  const client = createClient();
  assert.equal((await findByOperationType(client, 'missing')), null);
  assert.equal((await findDefault(client)).operation_type, '__default__');
  await upsert(client, { operationType: 'create-workspace', maxRetries: 3, backoffStrategy: 'fixed', backoffBaseSeconds: 5, interventionConditions: [], failureCategories: {}, isDefault: false });
  assert.equal((await findByOperationType(client, 'create-workspace')).max_retries, 3);
});
