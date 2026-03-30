import { findByOperationType, findDefault } from '../repositories/retry-semantics-profile-repo.mjs';
import { resolveProfile } from '../models/retry-semantics-profile.mjs';

export function buildRetrySemanticsDependencies(overrides = {}) {
  return { db: overrides.db, findByOperationType: overrides.findByOperationType ?? findByOperationType, findDefault: overrides.findDefault ?? findDefault };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildRetrySemanticsDependencies(overrides);
  const operationType = params.operationType ?? params.operation_type ?? null;
  const specific = operationType ? await dependencies.findByOperationType(dependencies.db, operationType) : null;
  const fallback = await dependencies.findDefault(dependencies.db);
  if (!fallback && !specific) {
    return { statusCode: 500, body: { error: 'DEFAULT_PROFILE_MISSING', message: 'Retry semantics default profile is not configured.' } };
  }
  const resolved = resolveProfile(specific, fallback);
  return { statusCode: 200, body: { operationType: resolved.operationType, maxRetries: resolved.maxRetries, backoffStrategy: resolved.backoffStrategy, backoffBaseSeconds: resolved.backoffBaseSeconds, interventionConditions: resolved.interventionConditions, failureCategories: resolved.failureCategories, isDefault: !specific || resolved.isDefault } };
}
