import crypto from 'node:crypto';
import * as eventsAdmin from '../events-admin.mjs';
import {
  getAuditEventSchemaForSubsystem,
  readObservabilityAuditCorrelationSurface,
  readObservabilityAuditEventSchema
} from '../../../../services/internal-contracts/src/index.mjs';

const AUDIT_SCHEMA_VERSION = '2026-03-28';
const SENSITIVE_FIELD_PATTERN = /password|secret|token|credential|key/i;
const SENSITIVE_CATEGORY = 'credential_secret';

const testHooks = {
  emitAuditRecord: null,
  onWarn: null,
  onRecordPrepared: null
};

export function __setWorkflowAuditHooksForTesting(hooks = {}) {
  testHooks.emitAuditRecord = hooks.emitAuditRecord ?? null;
  testHooks.onWarn = hooks.onWarn ?? null;
  testHooks.onRecordPrepared = hooks.onRecordPrepared ?? null;
}

function warnAudit(message, meta = {}) {
  const payload = { level: 'warn', message, ...meta };
  if (typeof testHooks.onWarn === 'function') {
    testHooks.onWarn(payload);
    return;
  }
  console.warn('[workflow-audit]', payload);
}

function assertSagaAuditContext(sagaCtx = {}) {
  if (!sagaCtx.correlationId) {
    throw { code: 'AUDIT_MISSING_CORRELATION_ID' };
  }
  if (!sagaCtx.tenantId) {
    throw { code: 'AUDIT_MISSING_TENANT_ID' };
  }
}

function sanitizeDetail(detail = {}) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return {};
  }

  const cloned = structuredClone(detail);
  delete cloned.params;
  delete cloned.stepOutput;
  return cloned;
}

function shouldMaskField(key, path) {
  if (path === 'stepKey') {
    return false;
  }
  return SENSITIVE_FIELD_PATTERN.test(key);
}

function maskValue(value, path, state) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => maskValue(entry, `${path}[${index}]`, state));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const nextPath = path ? `${path}.${key}` : key;
        if (shouldMaskField(key, nextPath)) {
          state.maskedFieldRefs.push(nextPath);
          if (!state.sensitivityCategories.includes(SENSITIVE_CATEGORY)) {
            state.sensitivityCategories.push(SENSITIVE_CATEGORY);
          }
          return [key, '[REDACTED]'];
        }
        return [key, maskValue(entry, nextPath, state)];
      })
    );
  }

  return value;
}

export function maskAuditDetail(detail = {}) {
  const sanitized = sanitizeDetail(detail);
  const state = { maskedFieldRefs: [], sensitivityCategories: [] };
  const masked = maskValue(sanitized, '', state);

  return {
    masked,
    maskedFieldRefs: state.maskedFieldRefs,
    sensitivityCategories: state.sensitivityCategories,
    maskingApplied: state.maskedFieldRefs.length > 0
  };
}

export function validateAuditRecord(record = {}) {
  const violations = [];
  const requiredTopLevelFields = [
    'event_id',
    'event_timestamp',
    'schema_version',
    'actor',
    'scope',
    'resource',
    'action',
    'result',
    'correlation_id',
    'origin'
  ];

  for (const field of requiredTopLevelFields) {
    if (record[field] == null) {
      violations.push(`${field} missing`);
    }
  }

  if (!record.actor?.actor_id) violations.push('actor.actor_id missing');
  if (!record.actor?.actor_type) violations.push('actor.actor_type missing');
  if (!record.scope?.tenant_id) violations.push('scope.tenant_id missing');
  if (!record.resource?.subsystem_id) violations.push('resource.subsystem_id missing');
  if (!record.action?.action_id) violations.push('action.action_id missing');
  if (!record.result?.outcome) violations.push('result.outcome missing');

  return { ok: violations.length === 0, violations };
}

function buildBaseRecord(sagaCtx, actionId, outcome, detail = {}) {
  assertSagaAuditContext(sagaCtx);

  const auditEventSchema = readObservabilityAuditEventSchema();
  const subsystemSchema = getAuditEventSchemaForSubsystem('openwhisk') ?? auditEventSchema;
  const maskingProfile = readObservabilityAuditCorrelationSurface()?.masking_profiles?.default_masked?.id ?? 'default_masked';
  const maskedDetail = maskAuditDetail(detail);

  const record = {
    event_id: crypto.randomUUID(),
    event_timestamp: new Date().toISOString(),
    schema_version: AUDIT_SCHEMA_VERSION,
    actor: {
      actor_id: sagaCtx.actorId ?? 'unknown',
      actor_type: sagaCtx.actorType ?? 'unknown'
    },
    scope: {
      mode: sagaCtx.workspaceId ? 'tenant_workspace' : 'tenant',
      tenant_id: sagaCtx.tenantId,
      ...(sagaCtx.workspaceId ? { workspace_id: sagaCtx.workspaceId } : {})
    },
    resource: {
      subsystem_id: subsystemSchema?.subsystem_id ?? 'openwhisk',
      resource_type: 'console_workflow',
      resource_id: sagaCtx.sagaId,
      parent_resource_id: sagaCtx.workflowId
    },
    action: {
      category: 'console_workflow_execution',
      action_id: actionId
    },
    result: {
      outcome
    },
    correlation_id: sagaCtx.correlationId,
    origin: {
      surface: 'console_backend'
    },
    detail: {
      workflowId: sagaCtx.workflowId,
      sagaId: sagaCtx.sagaId,
      maskingProfile,
      ...maskedDetail.masked
    },
    maskingApplied: maskedDetail.maskingApplied,
    maskedFieldRefs: maskedDetail.maskedFieldRefs,
    sensitivityCategories: maskedDetail.sensitivityCategories
  };

  if (typeof testHooks.onRecordPrepared === 'function') {
    testHooks.onRecordPrepared(record);
  }

  return record;
}

async function publishAuditRecord(record) {
  if (typeof testHooks.emitAuditRecord === 'function') {
    return testHooks.emitAuditRecord(record);
  }

  if (typeof eventsAdmin.emitAuditRecord === 'function') {
    return eventsAdmin.emitAuditRecord(record);
  }

  if (typeof eventsAdmin.emit === 'function') {
    return eventsAdmin.emit({ type: 'audit.record', record });
  }

  return { accepted: false, reason: 'no-audit-emitter-configured' };
}

async function emitAuditRecord(record) {
  const validation = validateAuditRecord(record);
  if (!validation.ok) {
    warnAudit('audit record validation failed', {
      sagaId: record.resource?.resource_id,
      correlationId: record.correlation_id,
      violations: validation.violations
    });
    return { eventId: record.event_id, emitted: false, violations: validation.violations };
  }

  try {
    await publishAuditRecord(record);
  } catch (error) {
    warnAudit('audit record emission failed', {
      sagaId: record.resource?.resource_id,
      correlationId: record.correlation_id,
      error: error?.message ?? String(error)
    });
  }

  return { eventId: record.event_id };
}

export async function emitWorkflowStarted(sagaCtx) {
  const record = buildBaseRecord(sagaCtx, 'workflow.started', 'started', {
    phase: 'console_initiation'
  });
  return emitAuditRecord(record);
}

export async function emitStepMilestone(stepDef, stepStatus, sagaCtx, detail = {}) {
  const record = buildBaseRecord(sagaCtx, `step.${stepStatus}`, stepStatus === 'succeeded' ? 'step_succeeded' : 'step_failed', {
    phase: 'control_plane_execution',
    stepKey: stepDef?.key,
    ordinal: stepDef?.ordinal,
    ...detail
  });
  return emitAuditRecord(record);
}

export async function emitWorkflowTerminal(sagaCtx, terminalStatus, detail = {}) {
  const record = buildBaseRecord(sagaCtx, 'workflow.terminal', terminalStatus, {
    phase: 'audit_persistence',
    ...detail
  });
  return emitAuditRecord(record);
}
