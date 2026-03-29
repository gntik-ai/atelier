import { readFileSync } from 'node:fs';

import { readAuthorizationModel } from '../../../../services/internal-contracts/src/index.mjs';

const INVOCATION_SCHEMA_URL = new URL('../../../../services/internal-contracts/src/console-workflow-invocation.json', import.meta.url);
const invocationSchema = JSON.parse(readFileSync(INVOCATION_SCHEMA_URL, 'utf8'));
const authorizationModel = readAuthorizationModel();

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALLER_TYPES = new Set(invocationSchema.definitions?.callerContext?.properties?.actorType?.enum ?? []);
const WORKFLOW_INPUT_SHAPES = invocationSchema.workflowInputShapes ?? {};

export const WORKFLOW_AUTHORIZATION_MODEL = Object.freeze({ ...(authorizationModel?.workflow_authorization ?? {}) });

function normalizeCallerContext(callerContext = {}) {
  return {
    actor: callerContext.actor ?? callerContext.actor_id ?? null,
    actorType: callerContext.actorType ?? callerContext.actor_type ?? null,
    tenantId: callerContext.tenantId ?? callerContext.tenant_id ?? null,
    workspaceId: callerContext.workspaceId ?? callerContext.workspace_id ?? null,
    correlationId: callerContext.correlationId ?? callerContext.correlation_id ?? null,
    requestTenantId: callerContext.requestTenantId ?? callerContext.request_tenant_id ?? null,
    requestWorkspaceId: callerContext.requestWorkspaceId ?? callerContext.request_workspace_id ?? null,
    effectiveRoles: Array.isArray(callerContext.effectiveRoles)
      ? [...callerContext.effectiveRoles]
      : Array.isArray(callerContext.effective_roles)
        ? [...callerContext.effective_roles]
        : undefined
  };
}

function normalizeRequest(raw = {}) {
  return {
    workflowId: raw.workflowId ?? raw.workflow_id ?? null,
    idempotencyKey: raw.idempotencyKey ?? raw.idempotency_key ?? null,
    callerContext: normalizeCallerContext(raw.callerContext ?? raw.caller_context ?? {}),
    input: raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input) ? { ...raw.input } : raw.input,
    asyncHint: raw.asyncHint ?? raw.async_hint
  };
}

function validateWorkflowSpecificInput(workflowId, input, violations) {
  const shape = WORKFLOW_INPUT_SHAPES[workflowId] ?? {};
  const requiredFields = Array.isArray(shape.required) ? shape.required : [];

  for (const field of requiredFields) {
    if (input?.[field] === undefined || input?.[field] === null || input?.[field] === '') {
      violations.push(`input.${field} is required for ${workflowId}.`);
    }
  }

  if (shape.credentialAction?.enum && input?.credentialAction && !shape.credentialAction.enum.includes(input.credentialAction)) {
    violations.push(`input.credentialAction must be one of ${shape.credentialAction.enum.join(', ')}.`);
  }

  if (shape.serviceAccountAction?.enum && input?.serviceAccountAction && !shape.serviceAccountAction.enum.includes(input.serviceAccountAction)) {
    violations.push(`input.serviceAccountAction must be one of ${shape.serviceAccountAction.enum.join(', ')}.`);
  }

  if (workflowId === 'WF-CON-002' && typeof input?.adminEmail === 'string' && !input.adminEmail.includes('@')) {
    violations.push('input.adminEmail must be a valid email address.');
  }
}

export function validateInvocationRequest(raw) {
  const request = normalizeRequest(raw);
  const violations = [];

  if (!request.workflowId || typeof request.workflowId !== 'string' || !/^WF-CON-0[0-9]{2}$/.test(request.workflowId)) {
    violations.push('workflowId must match the WF-CON-0NN format.');
  }

  if (!request.idempotencyKey || typeof request.idempotencyKey !== 'string' || !UUID_V4_PATTERN.test(request.idempotencyKey)) {
    violations.push('idempotencyKey must be a UUID v4 string.');
  }

  if (!request.callerContext.actor || typeof request.callerContext.actor !== 'string') {
    violations.push('callerContext.actor is required.');
  }

  if (!request.callerContext.actorType || !CALLER_TYPES.has(request.callerContext.actorType)) {
    violations.push(`callerContext.actorType must be one of ${Array.from(CALLER_TYPES).join(', ')}.`);
  }

  if (!request.callerContext.tenantId || typeof request.callerContext.tenantId !== 'string') {
    violations.push('callerContext.tenantId is required.');
  }

  if (!request.callerContext.correlationId || typeof request.callerContext.correlationId !== 'string') {
    violations.push('callerContext.correlationId is required.');
  }

  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    violations.push('input must be an object.');
  } else if (request.workflowId) {
    validateWorkflowSpecificInput(request.workflowId, request.input, violations);
  }

  return {
    ok: violations.length === 0,
    ...(violations.length === 0 ? { request } : {}),
    ...(violations.length > 0 ? { violations } : {})
  };
}

export function validateCallerAuthorization(callerContext, workflowId, workflowAuthorization = WORKFLOW_AUTHORIZATION_MODEL) {
  const normalizedCallerContext = normalizeCallerContext(callerContext);
  const rule = workflowAuthorization?.[workflowId];

  if (!rule) {
    return { authorized: false, reason: `No workflow authorization rule exists for ${workflowId}.` };
  }

  const effectiveRoles = Array.isArray(normalizedCallerContext.effectiveRoles) && normalizedCallerContext.effectiveRoles.length > 0
    ? normalizedCallerContext.effectiveRoles
    : [normalizedCallerContext.actorType].filter(Boolean);

  if (rule.isolation === 'superadmin' && normalizedCallerContext.actorType !== 'superadmin') {
    return { authorized: false, reason: 'Superadmin required.' };
  }

  if (Array.isArray(rule.required_roles) && rule.required_roles.length > 0) {
    const hasRequiredRole = rule.required_roles.some((role) => effectiveRoles.includes(role));
    if (!hasRequiredRole) {
      return { authorized: false, reason: `Caller lacks one of the required roles for ${workflowId}.` };
    }
  }

  if (rule.isolation === 'tenant-scoped') {
    if (!normalizedCallerContext.tenantId) {
      return { authorized: false, reason: 'Tenant-scoped workflow requires callerContext.tenantId.' };
    }

    const requestedTenantId = normalizedCallerContext.requestTenantId;
    if (requestedTenantId && requestedTenantId !== normalizedCallerContext.tenantId) {
      return { authorized: false, reason: 'Caller cannot cross tenant boundaries.' };
    }

    const requestedWorkspaceId = normalizedCallerContext.requestWorkspaceId;
    if (normalizedCallerContext.workspaceId && requestedWorkspaceId && requestedWorkspaceId !== normalizedCallerContext.workspaceId) {
      return { authorized: false, reason: 'Caller cannot cross workspace boundaries.' };
    }
  }

  return { authorized: true };
}

export function buildAuditFields(workflowId, callerContext, affectedResources = [], outcome) {
  const normalizedCallerContext = normalizeCallerContext(callerContext);
  return {
    workflowId,
    actor: normalizedCallerContext.actor,
    tenantId: normalizedCallerContext.tenantId,
    workspaceId: normalizedCallerContext.workspaceId ?? null,
    timestamp: new Date().toISOString(),
    affectedResources: Array.isArray(affectedResources) ? [...affectedResources] : [],
    outcome
  };
}

export function buildErrorResult(workflowId, idempotencyKey, code, message, failedStep = null) {
  return {
    workflowId,
    idempotencyKey,
    status: 'failed',
    jobRef: null,
    output: null,
    errorSummary: {
      code,
      message,
      failedStep
    },
    auditFields: buildAuditFields(
      workflowId,
      {
        actor: 'unknown',
        tenantId: 'unknown',
        workspaceId: null,
        correlationId: null
      },
      [],
      'failed'
    )
  };
}
