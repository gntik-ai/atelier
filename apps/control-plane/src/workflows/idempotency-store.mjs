const inMemoryRecords = new Map();
let persistenceAdapter = null;

const SECRETISH_KEYS = new Set([
  'credential',
  'secret',
  'secretValue',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'password'
]);

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sanitizeValue(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    if (parentKey && SECRETISH_KEYS.has(parentKey)) {
      return null;
    }
    return value;
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SECRETISH_KEYS.has(key)) {
      sanitized[key] = null;
      continue;
    }
    sanitized[key] = sanitizeValue(nestedValue, key);
  }
  return sanitized;
}

function getMemoryRecord(key) {
  const record = inMemoryRecords.get(key);
  return record ? deepClone(record) : null;
}

function setMemoryRecord(key, record) {
  inMemoryRecords.set(key, deepClone(record));
}

async function tryAdapter(method, ...args) {
  if (!persistenceAdapter || typeof persistenceAdapter[method] !== 'function') {
    return { used: false, value: undefined };
  }

  try {
    return { used: true, value: await persistenceAdapter[method](...args) };
  } catch (error) {
    if (error?.status === 404 || error?.status === 503 || error?.code === 'STATE_API_UNAVAILABLE') {
      return { used: true, unavailable: true, error };
    }
    throw error;
  }
}

export class BaaSStateUnavailableError extends Error {
  constructor(message = 'BaaS state storage is unavailable.') {
    super(message);
    this.name = 'BaaSStateUnavailableError';
    this.code = 'DOWNSTREAM_UNAVAILABLE';
  }
}

export function __setPersistenceAdapterForTest(adapter) {
  persistenceAdapter = adapter ?? null;
}

export function _resetForTest() {
  inMemoryRecords.clear();
  persistenceAdapter = null;
}

export async function checkIdempotency(key) {
  const adapterResult = await tryAdapter('getRecord', key);
  const record = adapterResult.used && !adapterResult.unavailable
    ? adapterResult.value
    : getMemoryRecord(key);

  if (!record) {
    return { state: 'new' };
  }

  return {
    state: record.state,
    ...(record.resultSummary ? { cachedResult: deepClone(record.resultSummary) } : {}),
    ...(record.jobRef ? { jobRef: record.jobRef } : {})
  };
}

export async function markPending(key, workflowId, tenantId, workspaceId, jobRef = null) {
  const existing = await checkIdempotency(key);
  if (existing.state !== 'new') {
    return { written: false };
  }

  const nextRecord = {
    key,
    workflowId,
    tenantId,
    workspaceId: workspaceId ?? null,
    jobRef: jobRef ?? null,
    state: 'pending',
    resultSummary: null,
    errorSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const adapterResult = await tryAdapter('putPending', deepClone(nextRecord));
  if (adapterResult.used && adapterResult.unavailable && !persistenceAdapter?.allowMemoryFallback) {
    throw new BaaSStateUnavailableError();
  }

  setMemoryRecord(key, nextRecord);
  return { written: true };
}

export async function markSucceeded(key, resultSummary) {
  const current = getMemoryRecord(key) ?? {
    key,
    state: 'pending',
    createdAt: new Date().toISOString()
  };
  const sanitizedResultSummary = sanitizeValue(deepClone(resultSummary));
  const nextRecord = {
    ...current,
    state: 'succeeded',
    resultSummary: sanitizedResultSummary,
    errorSummary: null,
    jobRef: current.jobRef ?? sanitizedResultSummary?.jobRef ?? null,
    updatedAt: new Date().toISOString()
  };

  const adapterResult = await tryAdapter('putSucceeded', key, deepClone(nextRecord));
  if (adapterResult.used && adapterResult.unavailable && !persistenceAdapter?.allowMemoryFallback) {
    throw new BaaSStateUnavailableError();
  }

  setMemoryRecord(key, nextRecord);
}

export async function markFailed(key, errorSummary) {
  const current = getMemoryRecord(key) ?? {
    key,
    state: 'pending',
    createdAt: new Date().toISOString()
  };
  const nextRecord = {
    ...current,
    state: 'failed',
    errorSummary: deepClone(errorSummary),
    resultSummary: null,
    updatedAt: new Date().toISOString()
  };

  const adapterResult = await tryAdapter('putFailed', key, deepClone(nextRecord));
  if (adapterResult.used && adapterResult.unavailable && !persistenceAdapter?.allowMemoryFallback) {
    throw new BaaSStateUnavailableError();
  }

  setMemoryRecord(key, nextRecord);
}
