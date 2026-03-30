const FAILURE_CATEGORIES = ['transient', 'permanent', 'requires_intervention', 'unknown'];

export const FailureCategory = Object.freeze({
  TRANSIENT: 'transient',
  PERMANENT: 'permanent',
  REQUIRES_INTERVENTION: 'requires_intervention',
  UNKNOWN: 'unknown'
});

function normalizeErrorCode(errorCode) {
  if (errorCode === null || errorCode === undefined) {
    return null;
  }

  const value = `${errorCode}`.trim();
  return value.length > 0 ? value : null;
}

function validateCategory(category) {
  if (!FAILURE_CATEGORIES.includes(category)) {
    throw Object.assign(new Error(`Unsupported failure category: ${category}`), { code: 'VALIDATION_ERROR' });
  }
}

export function FailureClassification({ category, errorCode = null, description, suggestedActions = [] } = {}) {
  validateCategory(category);
  if (!description || !`${description}`.trim()) {
    throw Object.assign(new Error('description is required'), { code: 'VALIDATION_ERROR' });
  }
  if (!Array.isArray(suggestedActions)) {
    throw Object.assign(new Error('suggestedActions must be an array'), { code: 'VALIDATION_ERROR' });
  }

  return Object.freeze({
    category,
    errorCode: normalizeErrorCode(errorCode),
    description: `${description}`.trim(),
    suggestedActions: suggestedActions.map((item) => `${item}`)
  });
}

export function loadMappingCache(rows = []) {
  return rows
    .map((row, index) => ({
      errorCode: normalizeErrorCode(row.error_code ?? row.errorCode),
      operationType: row.operation_type ?? row.operationType ?? null,
      category: row.failure_category ?? row.failureCategory,
      description: row.description,
      suggestedActions: row.suggested_actions ?? row.suggestedActions ?? [],
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
      index
    }))
    .filter((row) => row.errorCode)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
}

function buildUnknownClassification(errorCode) {
  return FailureClassification({
    category: FailureCategory.UNKNOWN,
    errorCode,
    description: 'Failure could not be classified automatically.',
    suggestedActions: ['Inspect logs and escalate for manual review if the failure persists.']
  });
}

export function classifyByErrorCode(errorCode, operationType, mappingCache = []) {
  const normalizedErrorCode = normalizeErrorCode(errorCode);
  if (!normalizedErrorCode) {
    return buildUnknownClassification(null);
  }

  const exact = mappingCache.find((entry) => entry.errorCode === normalizedErrorCode && entry.operationType === (operationType ?? null));
  const generic = mappingCache.find((entry) => entry.errorCode === normalizedErrorCode && entry.operationType === null);
  const match = exact ?? generic;

  if (!match) {
    return buildUnknownClassification(normalizedErrorCode);
  }

  return FailureClassification({
    category: match.category,
    errorCode: normalizedErrorCode,
    description: match.description,
    suggestedActions: match.suggestedActions
  });
}
