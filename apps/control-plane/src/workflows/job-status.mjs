import { buildWorkflowAsyncJobRef } from '../../../../services/adapters/src/openwhisk-admin.mjs';

const jobRecords = new Map();
let persistenceAdapter = null;

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: new Set(['running']),
  running: new Set(['succeeded', 'failed']),
  succeeded: new Set(),
  failed: new Set()
});

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function publicShape(record) {
  return {
    jobRef: record.jobRef,
    workflowId: record.workflowId,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    result: record.result ?? null,
    errorSummary: record.errorSummary ?? null,
    auditFields: record.auditFields ?? null,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId ?? null,
    actor: record.actor
  };
}

async function adapterCall(method, ...args) {
  if (!persistenceAdapter || typeof persistenceAdapter[method] !== 'function') {
    return { used: false, value: undefined };
  }
  return { used: true, value: await persistenceAdapter[method](...args) };
}

export class InvalidJobStateTransitionError extends Error {
  constructor(fromState, toState) {
    super(`Invalid job state transition: ${fromState} -> ${toState}`);
    this.name = 'InvalidJobStateTransitionError';
    this.code = 'INVALID_JOB_STATE_TRANSITION';
  }
}

export class CrossTenantJobAccessError extends Error {
  constructor(jobRef) {
    super(`Cross-tenant access denied for job ${jobRef}.`);
    this.name = 'CrossTenantJobAccessError';
    this.code = 'FORBIDDEN';
  }
}

export function __setJobStatusAdapterForTest(adapter) {
  persistenceAdapter = adapter ?? null;
}

export function _resetForTest() {
  jobRecords.clear();
  persistenceAdapter = null;
}

export async function registerJob(workflowId, idempotencyKey, callerContext = {}) {
  const jobRef = buildWorkflowAsyncJobRef(workflowId, idempotencyKey);
  const existing = jobRecords.get(jobRef);
  if (existing) {
    return jobRef;
  }

  const now = new Date().toISOString();
  const record = {
    jobRef,
    workflowId,
    idempotencyKey,
    tenantId: callerContext.tenantId ?? 'unknown-tenant',
    workspaceId: callerContext.workspaceId ?? null,
    actor: callerContext.actor ?? 'unknown-actor',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    result: null,
    errorSummary: null,
    auditFields: null
  };

  const adapterResult = await adapterCall('createJob', deepClone(record));
  if (adapterResult.used && adapterResult.value) {
    jobRecords.set(jobRef, deepClone(adapterResult.value));
  } else {
    jobRecords.set(jobRef, record);
  }

  return jobRef;
}

export async function updateJobStatus(jobRef, status, resultOrError) {
  const current = jobRecords.get(jobRef);
  if (!current) {
    throw new Error(`Job not found: ${jobRef}`);
  }

  const allowedTargets = ALLOWED_TRANSITIONS[current.status] ?? new Set();
  if (!allowedTargets.has(status)) {
    throw new InvalidJobStateTransitionError(current.status, status);
  }

  const nextRecord = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    result: status === 'succeeded' ? deepClone(resultOrError) : null,
    errorSummary: status === 'failed' ? deepClone(resultOrError) : null,
    auditFields: status === 'succeeded'
      ? deepClone(resultOrError?.auditFields ?? current.auditFields ?? null)
      : status === 'failed'
        ? deepClone(resultOrError?.auditFields ?? current.auditFields ?? null)
        : current.auditFields ?? null
  };

  await adapterCall('updateJob', jobRef, deepClone(nextRecord));
  jobRecords.set(jobRef, nextRecord);
}

export async function queryJobStatus(jobRef, callerContext = {}) {
  const startedAt = Date.now();
  const adapterResult = await adapterCall('getJob', jobRef);
  const record = adapterResult.used && adapterResult.value
    ? deepClone(adapterResult.value)
    : deepClone(jobRecords.get(jobRef));

  if (!record) {
    throw new Error(`Job not found: ${jobRef}`);
  }

  if (callerContext.tenantId && record.tenantId && callerContext.tenantId !== record.tenantId) {
    throw new CrossTenantJobAccessError(jobRef);
  }

  const response = publicShape(record);
  response.responseTimeMs = Date.now() - startedAt;
  return response;
}
