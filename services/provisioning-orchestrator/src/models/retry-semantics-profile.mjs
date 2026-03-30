export const DEFAULT_OPERATION_TYPE = '__default__';
const ALLOWED_BACKOFF_STRATEGIES = new Set(['fixed', 'linear', 'exponential']);

export function RetrySemanticProfile({
  operationType = DEFAULT_OPERATION_TYPE,
  maxRetries = 5,
  backoffStrategy = 'exponential',
  backoffBaseSeconds = 30,
  interventionConditions = [],
  failureCategories = {},
  isDefault = operationType === DEFAULT_OPERATION_TYPE
} = {}) {
  if (!operationType || !`${operationType}`.trim()) {
    throw Object.assign(new Error('operationType is required'), { code: 'VALIDATION_ERROR' });
  }
  if (!ALLOWED_BACKOFF_STRATEGIES.has(backoffStrategy)) {
    throw Object.assign(new Error(`Unsupported backoffStrategy: ${backoffStrategy}`), { code: 'VALIDATION_ERROR' });
  }

  return Object.freeze({
    operationType: `${operationType}`,
    maxRetries: Number(maxRetries),
    backoffStrategy,
    backoffBaseSeconds: Number(backoffBaseSeconds),
    interventionConditions: Array.isArray(interventionConditions) ? interventionConditions : [],
    failureCategories: failureCategories && typeof failureCategories === 'object' ? failureCategories : {},
    isDefault: Boolean(isDefault)
  });
}

export function resolveProfile(specific, defaultProfile) {
  if (!specific && !defaultProfile) {
    throw Object.assign(new Error('default profile is required'), { code: 'VALIDATION_ERROR' });
  }

  const merged = {
    ...(defaultProfile ?? {}),
    ...(specific ?? {})
  };

  return RetrySemanticProfile({
    operationType: specific?.operationType ?? specific?.operation_type ?? defaultProfile?.operationType ?? defaultProfile?.operation_type ?? DEFAULT_OPERATION_TYPE,
    maxRetries: specific?.maxRetries ?? specific?.max_retries ?? defaultProfile?.maxRetries ?? defaultProfile?.max_retries ?? 5,
    backoffStrategy: specific?.backoffStrategy ?? specific?.backoff_strategy ?? defaultProfile?.backoffStrategy ?? defaultProfile?.backoff_strategy ?? 'exponential',
    backoffBaseSeconds: specific?.backoffBaseSeconds ?? specific?.backoff_base_seconds ?? defaultProfile?.backoffBaseSeconds ?? defaultProfile?.backoff_base_seconds ?? 30,
    interventionConditions: specific?.interventionConditions ?? specific?.intervention_conditions ?? defaultProfile?.interventionConditions ?? defaultProfile?.intervention_conditions ?? [],
    failureCategories: specific?.failureCategories ?? specific?.failure_categories ?? defaultProfile?.failureCategories ?? defaultProfile?.failure_categories ?? {},
    isDefault: merged.isDefault ?? merged.is_default ?? false
  });
}
