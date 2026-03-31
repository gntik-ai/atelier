import { randomUUID } from 'node:crypto';
import { scopeEnforcementDenialEventSchema } from '../../../internal-contracts/src/index.mjs';

export const SCOPE_ENFORCEMENT_TOPICS = Object.freeze({
  SCOPE_INSUFFICIENT: process.env.SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED ?? 'console.security.scope-denied',
  PLAN_ENTITLEMENT_DENIED: process.env.SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED ?? 'console.security.plan-denied',
  WORKSPACE_SCOPE_MISMATCH: process.env.SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH ?? 'console.security.workspace-mismatch',
  CONFIG_ERROR: process.env.SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR ?? 'console.security.config-error'
});

function validateRequiredFields(event, schema) {
  for (const field of schema.required ?? []) {
    if (event[field] === undefined) throw Object.assign(new Error(`Missing required event field: ${field}`), { code: 'VALIDATION_ERROR', field });
  }
  return event;
}

export function buildScopeEnforcementDenialEvent(denial) {
  return validateRequiredFields({
    event_id: denial.eventId ?? randomUUID(),
    event_type: denial.denialType,
    tenant_id: denial.tenantId,
    workspace_id: denial.workspaceId ?? null,
    actor_id: denial.actorId,
    actor_type: denial.actorType,
    denial_type: denial.denialType,
    http_method: denial.httpMethod,
    request_path: denial.requestPath,
    required_scopes: denial.requiredScopes ?? [],
    presented_scopes: denial.presentedScopes ?? [],
    missing_scopes: denial.missingScopes ?? [],
    required_entitlement: denial.requiredEntitlement ?? null,
    current_plan_id: denial.currentPlanId ?? null,
    source_ip: denial.sourceIp ?? '0.0.0.0',
    correlation_id: denial.correlationId,
    denied_at: denial.deniedAt ?? new Date().toISOString()
  }, scopeEnforcementDenialEventSchema);
}

async function publish(producer, event) {
  const topic = SCOPE_ENFORCEMENT_TOPICS[event.denial_type];
  if (!producer?.send) return { published: false, topic, event };
  await producer.send({ topic, messages: [{ key: event.tenant_id, value: JSON.stringify(event) }] });
  return { published: true, topic, event };
}

export async function publishScopeEnforcementDenial(producer, denial) {
  return publish(producer, buildScopeEnforcementDenialEvent(denial));
}

export async function publishConfigError(producer, payload) {
  return publishScopeEnforcementDenial(producer, { ...payload, denialType: 'CONFIG_ERROR' });
}
